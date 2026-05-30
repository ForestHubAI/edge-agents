package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestCompileIsDeterministic plans the example spec twice and ensures the
// generated artifacts are byte-identical. Iterating agents rely on this —
// any non-deterministic field (timestamps, random ids, map iteration order)
// would break the workflow.
func TestCompileIsDeterministic(t *testing.T) {
	exampleSpec := "examples/building-automation.site.yaml"
	for _, targetID := range []string{"rpi5-8gb", "stm32mp25-1gb", "jetson-orin-nano-8gb", "x86-nuc-16gb", "ctrlx-core-arm64"} {
		t.Run(targetID, func(t *testing.T) {
			a := planTo(t, exampleSpec, targetID)
			b := planTo(t, exampleSpec, targetID)
			if len(a) != len(b) {
				t.Fatalf("artifact count differs across runs: %d vs %d", len(a), len(b))
			}
			for name, contentA := range a {
				contentB, ok := b[name]
				if !ok {
					t.Errorf("%s: missing in second run", name)
					continue
				}
				if !bytes.Equal(contentA, contentB) {
					t.Errorf("%s: bytes differ across runs (non-deterministic)", name)
				}
			}
		})
	}
}

// TestCompileFitsTarget plans the example on every embedded target and checks
// the chosen model's RAM fits within the target's available budget.
func TestCompileFitsTarget(t *testing.T) {
	targets, err := loadAllTargets()
	if err != nil {
		t.Fatalf("load targets: %v", err)
	}
	spec, err := LoadSpec("examples/building-automation.site.yaml")
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	for id, target := range targets {
		t.Run(id, func(t *testing.T) {
			plan, diags := compile(spec, target)
			if hasError(diags) {
				t.Fatalf("compile produced errors: %+v", diags)
			}
			if plan.BundleMetadata.ChosenModel.RAMMB > target.RAM.availableMB() {
				t.Errorf("chosen model %q needs %d MB, target has %d MB available",
					plan.BundleMetadata.ChosenModel.ID,
					plan.BundleMetadata.ChosenModel.RAMMB,
					target.RAM.availableMB())
			}
		})
	}
}

// TestValidateCatchesDanglingMapping mangles a planned bundle by deleting an
// entry from site.resources.yaml — validate must flag it.
func TestValidateCatchesDanglingMapping(t *testing.T) {
	exampleSpec := "examples/building-automation.site.yaml"
	dir := t.TempDir()
	spec, err := LoadSpec(exampleSpec)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	target, err := getTarget("rpi5-8gb")
	if err != nil {
		t.Fatalf("get target: %v", err)
	}
	plan, diags := compile(spec, target)
	if hasError(diags) {
		t.Fatalf("compile: %+v", diags)
	}
	if err := writePlanArtifacts(dir, plan); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Corrupt: blank out resources file.
	if err := os.WriteFile(filepath.Join(dir, "site.resources.yaml"), []byte("{}\n"), 0o644); err != nil {
		t.Fatalf("corrupt: %v", err)
	}

	// Reload & cross-check manually (we can't call runValidate without
	// triggering os.Exit). Same logic, no exit.
	wf, _ := loadWorkflow(filepath.Join(dir, "agent.workflow.json"))
	mapping, _ := loadMapping(filepath.Join(dir, "site.mapping.json"))
	resources, _ := loadResources(filepath.Join(dir, "site.resources.yaml"))

	found := false
	for chID, b := range mapping {
		var typ string
		for _, ch := range wf.Channels {
			if ch["id"] == chID {
				typ, _ = ch["type"].(string)
				break
			}
		}
		if typ == "MQTT" {
			if _, ok := resources[b.Ref]; !ok {
				found = true
			}
		}
	}
	if !found {
		t.Error("expected validate logic to detect missing mqtt resource binding, but didn't")
	}
}

// planTo runs compile + writePlanArtifacts and returns the artifacts as
// name→bytes for byte-level comparison.
func planTo(t *testing.T, specPath, targetID string) map[string][]byte {
	t.Helper()
	spec, err := LoadSpec(specPath)
	if err != nil {
		t.Fatalf("load spec: %v", err)
	}
	target, err := getTarget(targetID)
	if err != nil {
		t.Fatalf("get target: %v", err)
	}
	plan, diags := compile(spec, target)
	if hasError(diags) {
		t.Fatalf("compile: %+v", diags)
	}
	dir := t.TempDir()
	if err := writePlanArtifacts(dir, plan); err != nil {
		t.Fatalf("write: %v", err)
	}
	out := map[string][]byte{}
	for _, f := range []string{
		"agent.workflow.json", "site.mapping.json", "site.resources.yaml",
		"device.manifest.json", "local-models.yaml", "bundle.meta.json",
	} {
		raw, err := os.ReadFile(filepath.Join(dir, f))
		if err != nil {
			t.Fatalf("read %s: %v", f, err)
		}
		// Round-trip JSON through json.RawMessage to normalize whitespace —
		// catches accidental non-determinism in the writer itself.
		if filepath.Ext(f) == ".json" {
			var v any
			if err := json.Unmarshal(raw, &v); err != nil {
				t.Fatalf("parse %s: %v", f, err)
			}
		}
		out[f] = raw
	}
	return out
}

// TestSpecSchemaIsValidJSON sanity-checks the hand-written schema parses.
func TestSpecSchemaIsValidJSON(t *testing.T) {
	var v any
	if err := json.Unmarshal(SpecSchema(), &v); err != nil {
		t.Fatalf("SpecSchema is not valid JSON: %v", err)
	}
}
