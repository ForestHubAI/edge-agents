package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"gopkg.in/yaml.v3"
)

// runValidate cross-checks a build/ directory produced by `fh-agent plan`.
//
// What this DOES check:
//   - every workflow channel id has a mapping entry
//   - every mapping ref resolves to either an external resource or a manifest entry
//   - chosen model exists in local-models.yaml and fits target RAM
//   - bundle metadata schema version is current
//   - contract-schema validation via `fh-builder validate --json`
//     (subprocess; warn-skipped if fh-builder is not installed)
func runValidate(args []string) {
	fs := flag.NewFlagSet("validate", flag.ExitOnError)
	skipWorkflowCheck := fs.Bool("skip-workflow-check", false, "skip fh-builder contract-schema validation")
	_ = fs.Bool("json", true, "emit JSON diagnostics")
	pos := parseMixed(fs, args)
	if len(pos) < 1 {
		die(exitUsage, "usage: fh-agent validate <build-dir>")
	}
	dir := pos[0]

	wf, diags := loadWorkflow(filepath.Join(dir, "agent.workflow.json"))
	mapping, mdiags := loadMapping(filepath.Join(dir, "site.mapping.json"))
	resources, rdiags := loadResources(filepath.Join(dir, "site.resources.yaml"))
	manifest, manDiags := loadManifest(filepath.Join(dir, "device.manifest.json"))
	meta, metaDiags := loadMetadata(filepath.Join(dir, "bundle.meta.json"))
	diags = append(diags, mdiags...)
	diags = append(diags, rdiags...)
	diags = append(diags, manDiags...)
	diags = append(diags, metaDiags...)

	if hasError(diags) {
		emitDiags(os.Stderr, diags)
		os.Exit(exitDiagnostics)
	}

	// 1. Every channel id has a mapping entry.
	channelTypes := map[string]string{}
	for _, ch := range wf.Channels {
		id, _ := ch["id"].(string)
		typ, _ := ch["type"].(string)
		if id == "" {
			continue
		}
		channelTypes[id] = typ
		if _, ok := mapping[id]; !ok {
			diags = append(diags, Diagnostic{
				Severity: "error", Category: "validate",
				Message:  fmt.Sprintf("workflow channel %q has no mapping entry", id),
				Location: "site.mapping.json",
			})
		}
	}

	// 2. Every mapping ref resolves.
	for chID, b := range mapping {
		typ := channelTypes[chID]
		switch typ {
		case "MQTT":
			if _, ok := resources[b.Ref]; !ok {
				diags = append(diags, Diagnostic{
					Severity: "error", Category: "validate",
					Message:  fmt.Sprintf("mapping for %q points at resource %q not present in site.resources.yaml", chID, b.Ref),
					Location: "site.resources.yaml",
				})
			}
		case "GPIOIN", "GPIOOUT":
			if _, ok := manifest.GPIOs[b.Ref]; !ok {
				diags = append(diags, Diagnostic{
					Severity: "error", Category: "validate",
					Message:  fmt.Sprintf("mapping for %q points at gpio %q not present in device.manifest.json", chID, b.Ref),
					Location: "device.manifest.json",
				})
			}
		case "UART":
			if _, ok := manifest.Serials[b.Ref]; !ok {
				diags = append(diags, Diagnostic{
					Severity: "error", Category: "validate",
					Message:  fmt.Sprintf("mapping for %q points at serial %q not present in device.manifest.json", chID, b.Ref),
					Location: "device.manifest.json",
				})
			}
		}
	}

	// 3. Chosen model fits target.
	target, err := getTarget(meta.TargetID)
	if err != nil {
		diags = append(diags, Diagnostic{Severity: "error", Category: "validate", Message: err.Error()})
	} else {
		if meta.ChosenModel.RAMMB > target.RAM.availableMB() {
			diags = append(diags, Diagnostic{
				Severity: "error", Category: "validate",
				Message: fmt.Sprintf("chosen model %q needs %d MB RAM, target %q has only %d MB available",
					meta.ChosenModel.ID, meta.ChosenModel.RAMMB, target.ID, target.RAM.availableMB()),
			})
		}
		if !modelOnTarget(target, meta.ChosenModel.ID) {
			diags = append(diags, Diagnostic{
				Severity: "warn", Category: "validate",
				Message: fmt.Sprintf("chosen model %q is not in target %q's catalog — may not be available locally",
					meta.ChosenModel.ID, target.ID),
			})
		}
	}

	// 4. Bundle metadata schema.
	if meta.SchemaVersion != 1 {
		diags = append(diags, Diagnostic{
			Severity: "error", Category: "validate",
			Message: fmt.Sprintf("bundle.meta.json schemaVersion %d; expected 1", meta.SchemaVersion),
		})
	}

	// 5. Contract-schema validation via fh-builder. Subprocess; warn-skipped
	//    if fh-builder is not installed so the tool stays usable offline.
	if !*skipWorkflowCheck {
		diags = append(diags, runWorkflowSchemaCheck(filepath.Join(dir, "agent.workflow.json"))...)
	}

	emitDiags(os.Stderr, diags)
	if hasError(diags) {
		os.Exit(exitDiagnostics)
	}
}

// runWorkflowSchemaCheck shells out to `fh-builder validate <wf> --json`
// (the TS-side contract validator). Returns:
//   - the validator's diagnostics on success
//   - one warn-diagnostic if fh-builder is not in PATH (so the tool keeps
//     working in environments without Node)
//   - an error-diagnostic if subprocess failed for an unexpected reason
func runWorkflowSchemaCheck(workflowPath string) []Diagnostic {
	bin, err := exec.LookPath("fh-builder")
	if err != nil {
		return []Diagnostic{{
			Severity: "warn", Category: "validate",
			Message:  "fh-builder not in PATH — skipping contract-schema validation; install via `npm i -g @foresthubai/app` or pass --skip-workflow-check",
			Location: workflowPath,
		}}
	}
	cmd := exec.Command(bin, "validate", workflowPath, "--json")
	stdout, err := cmd.Output()
	if err != nil {
		// Exit 1 means the validator found errors; output is still valid JSON.
		if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
			return parseSchemaDiags(stdout, workflowPath)
		}
		return []Diagnostic{{
			Severity: "error", Category: "validate",
			Message: fmt.Sprintf("fh-builder validate failed unexpectedly: %v", err),
		}}
	}
	return parseSchemaDiags(stdout, workflowPath)
}

func parseSchemaDiags(stdout []byte, workflowPath string) []Diagnostic {
	if len(stdout) == 0 {
		return nil
	}
	var raw []map[string]any
	if err := json.Unmarshal(stdout, &raw); err != nil {
		return []Diagnostic{{
			Severity: "error", Category: "validate",
			Message: fmt.Sprintf("fh-builder JSON parse error: %v", err),
		}}
	}
	out := make([]Diagnostic, 0, len(raw))
	for _, r := range raw {
		d := Diagnostic{
			Severity: strOf(r["severity"]),
			Category: strOf(r["category"]),
			Message:  strOf(r["message"]),
			Location: workflowPath + "#" + strOf(r["location"]),
			NodeID:   strOf(r["nodeId"]),
		}
		out = append(out, d)
	}
	return out
}

func strOf(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func modelOnTarget(t *Target, id string) bool {
	for _, m := range t.SLMs {
		if m.ID == id {
			return true
		}
	}
	return false
}

// ----- minimal loaders for the build/ artifacts -----

func loadWorkflow(path string) (Workflow, []Diagnostic) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Workflow{}, []Diagnostic{{Severity: "error", Category: "validate", Message: "read agent.workflow.json: " + err.Error()}}
	}
	var wf Workflow
	if err := json.Unmarshal(raw, &wf); err != nil {
		return Workflow{}, []Diagnostic{{Severity: "error", Category: "validate", Message: "parse agent.workflow.json: " + err.Error()}}
	}
	return wf, nil
}

func loadMapping(path string) (DeploymentMapping, []Diagnostic) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, []Diagnostic{{Severity: "error", Category: "validate", Message: "read site.mapping.json: " + err.Error()}}
	}
	out := DeploymentMapping{}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, []Diagnostic{{Severity: "error", Category: "validate", Message: "parse site.mapping.json: " + err.Error()}}
	}
	return out, nil
}

func loadResources(path string) (ExternalResources, []Diagnostic) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, []Diagnostic{{Severity: "error", Category: "validate", Message: "read site.resources.yaml: " + err.Error()}}
	}
	out := ExternalResources{}
	if err := yaml.Unmarshal(raw, &out); err != nil {
		return nil, []Diagnostic{{Severity: "error", Category: "validate", Message: "parse site.resources.yaml: " + err.Error()}}
	}
	return out, nil
}

func loadManifest(path string) (DeviceManifest, []Diagnostic) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return DeviceManifest{}, []Diagnostic{{Severity: "error", Category: "validate", Message: "read device.manifest.json: " + err.Error()}}
	}
	var out DeviceManifest
	if err := json.Unmarshal(raw, &out); err != nil {
		return DeviceManifest{}, []Diagnostic{{Severity: "error", Category: "validate", Message: "parse device.manifest.json: " + err.Error()}}
	}
	return out, nil
}

func loadMetadata(path string) (BundleMetadata, []Diagnostic) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return BundleMetadata{}, []Diagnostic{{Severity: "error", Category: "validate", Message: "read bundle.meta.json: " + err.Error()}}
	}
	var out BundleMetadata
	if err := json.Unmarshal(raw, &out); err != nil {
		return BundleMetadata{}, []Diagnostic{{Severity: "error", Category: "validate", Message: "parse bundle.meta.json: " + err.Error()}}
	}
	return out, nil
}
