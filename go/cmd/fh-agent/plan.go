package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// runPlan is the heart of fh-agent: site.spec.yaml × target → build/ with
// five artifacts: agent.workflow.json, site.mapping.json, site.resources.yaml,
// device.manifest.json, local-models.yaml.
//
// MUST be deterministic — same spec + target → byte-identical output.
// Otherwise an iterating agent sees diff noise across re-plans.
func runPlan(args []string) {
	fs := flag.NewFlagSet("plan", flag.ExitOnError)
	targetID := fs.String("target", "", "hardware target id (overrides spec.target)")
	out := fs.String("out", "build", "output directory")
	pos := parseMixed(fs, args)
	if len(pos) < 1 {
		die(exitUsage, "usage: fh-agent plan <spec.yaml> [--target id] [--out build/]")
	}
	specPath := pos[0]

	spec, err := LoadSpec(specPath)
	if err != nil {
		emitDiags(os.Stderr, []Diagnostic{{Severity: "error", Category: "spec", Message: err.Error()}})
		os.Exit(exitDiagnostics)
	}
	if diags := ValidateSpec(spec); hasError(diags) {
		emitDiags(os.Stderr, diags)
		os.Exit(exitDiagnostics)
	}
	if *targetID != "" {
		spec.Target = *targetID
	}
	target, err := getTarget(spec.Target)
	if err != nil {
		emitDiags(os.Stderr, []Diagnostic{{Severity: "error", Category: "plan", Message: err.Error(), Location: "$.target"}})
		os.Exit(exitDiagnostics)
	}

	plan, diags := compile(spec, target)
	if hasError(diags) {
		emitDiags(os.Stderr, diags)
		os.Exit(exitDiagnostics)
	}

	if err := os.MkdirAll(*out, 0o755); err != nil {
		die(exitInfra, "mkdir %s: %v", *out, err)
	}
	if err := writePlanArtifacts(*out, plan); err != nil {
		die(exitInfra, "write artifacts: %v", err)
	}
	if len(diags) > 0 {
		emitDiags(os.Stderr, diags)
	}
	fmt.Fprintf(os.Stderr, "planned %s → %s (target=%s, %d devices, %d channels)\n",
		specPath, *out, target.ID, len(spec.Devices), len(plan.Workflow.Channels))
}

// planResult is the in-memory bundle the compile pass produces.
type planResult struct {
	Workflow        Workflow
	Mapping         DeploymentMapping
	Resources       ExternalResources
	DeviceManifest  DeviceManifest
	LocalModels     LocalModelsConfig
	BundleMetadata  BundleMetadata
}

// BundleMetadata is fh-agent–specific (not consumed by the engine). Kept in
// the build dir so 'fh-agent build' can render the compose stack without
// re-reading the spec.
type BundleMetadata struct {
	SchemaVersion int        `json:"schemaVersion" yaml:"schemaVersion"`
	SpecName      string     `json:"specName" yaml:"specName"`
	TargetID      string     `json:"targetId" yaml:"targetId"`
	TargetArch    string     `json:"targetArch" yaml:"targetArch"`
	SLMRuntime    TargetSLMRT `json:"slmRuntime" yaml:"slmRuntime"`
	ChosenModel   ChosenModel `json:"chosenModel" yaml:"chosenModel"`
}

type ChosenModel struct {
	ID        string `json:"id" yaml:"id"`
	RAMMB     int    `json:"ramMB" yaml:"ramMB"`
	GPURequest string `json:"gpuRequest,omitempty" yaml:"gpuRequest,omitempty"`
}

// ---------- engine-side artifact shapes (subset of contract) ----------

// Workflow is the subset of the engine workflow contract we emit. We treat
// node arguments as raw JSON objects so we can hand-craft per node type
// without modelling every field statically. The downstream
// `fh-workflow validate` is the authoritative schema check.
type Workflow struct {
	SchemaVersion     int                      `json:"schemaVersion"`
	Nodes             []map[string]any         `json:"nodes"`
	Edges             []map[string]any         `json:"edges"`
	Functions         []any                    `json:"functions"`
	DeclaredVariables []any                    `json:"declaredVariables"`
	Channels          []map[string]any         `json:"channels"`
	Memory            []any                    `json:"memory"`
	Models            []map[string]any         `json:"models"`
}

// DeploymentMapping per contract/engine.yaml — keyed by workflow resource id.
type DeploymentMapping map[string]ResourceBinding
type ResourceBinding struct {
	Ref   string `json:"ref"`
	Index *int   `json:"index,omitempty"`
}

// ExternalResources per contract/engine.yaml — keyed by platform resource id.
type ExternalResources map[string]map[string]any

// DeviceManifest per contract/engine.yaml — keyed by driver instance id.
type DeviceManifest struct {
	GPIOs   map[string]map[string]any `json:"gpios,omitempty"`
	Serials map[string]map[string]any `json:"serials,omitempty"`
	PWMs    map[string]map[string]any `json:"pwms,omitempty"`
	ADCs    map[string]map[string]any `json:"adcs,omitempty"`
	DACs    map[string]map[string]any `json:"dacs,omitempty"`
}

// LocalModelsConfig is the format the engine's Local LLM provider expects
// (see go/llmproxy README). One endpoint per process, models declared with
// capabilities.
type LocalModelsConfig struct {
	Endpoints []LocalEndpoint `yaml:"endpoints"`
}
type LocalEndpoint struct {
	URL    string        `yaml:"url"`
	Models []LocalModel  `yaml:"models"`
}
type LocalModel struct {
	ID           string   `yaml:"id"`
	Capabilities []string `yaml:"capabilities"`
	Dimension    int      `yaml:"dimension,omitempty"`
}

// ---------- compiler ----------

// compile is the deterministic pass spec × target → plan artifacts.
func compile(spec *Spec, target *Target) (planResult, []Diagnostic) {
	var diags []Diagnostic

	chosen, suggDiags := pickReasoningModel(spec, target)
	diags = append(diags, suggDiags...)

	workflow := Workflow{
		SchemaVersion:     1,
		Nodes:             []map[string]any{},
		Edges:             []map[string]any{},
		Functions:         []any{},
		DeclaredVariables: []any{},
		Channels:          []map[string]any{},
		Memory:            []any{},
		Models:            []map[string]any{},
	}
	mapping := DeploymentMapping{}
	resources := ExternalResources{}
	manifest := DeviceManifest{
		GPIOs:   map[string]map[string]any{},
		Serials: map[string]map[string]any{},
		PWMs:    map[string]map[string]any{},
		ADCs:    map[string]map[string]any{},
		DACs:    map[string]map[string]any{},
	}

	// Index spec.buses for fast lookup.
	busByID := map[string]Bus{}
	for _, b := range spec.Buses {
		busByID[b.ID] = b
	}

	// 1. Model declaration in workflow. Local SLM is referenced by id; the
	//    Local provider routes via the embedded local-models.yaml.
	if chosen.ID != "" {
		workflow.Models = append(workflow.Models, map[string]any{
			"type":         "LLMModel",
			"id":           chosen.ID,
			"label":        chosen.ID,
			"capabilities": []string{spec.Agent.Reasoning.Capability},
		})
	}

	// 2. Devices → channels (+ matching mapping/resources/manifest entries).
	//    Channels are sorted by stable id for reproducible output.
	sortedDevices := append([]Device(nil), spec.Devices...)
	sort.Slice(sortedDevices, func(i, j int) bool { return sortedDevices[i].ID < sortedDevices[j].ID })

	for _, d := range sortedDevices {
		bus := busByID[d.Bus.Ref]
		switch bus.Type {
		case "mqtt":
			chID := "ch-mqtt-" + sanitize(d.ID)
			workflow.Channels = append(workflow.Channels, map[string]any{
				"type":  "MQTT",
				"id":    chID,
				"label": d.ID,
				"topic": d.Bus.Topic,
			})
			// MQTT channels resolve against ExternalResources via mapping.ref.
			resID := "mqtt-" + sanitize(bus.ID)
			mapping[chID] = ResourceBinding{Ref: resID}
			resources[resID] = mqttResource(bus)

		case "gpio":
			direction := "GPIOIN"
			if d.Bus.Writable || d.Kind == "actuator" {
				direction = "GPIOOUT"
			}
			chID := "ch-gpio-" + sanitize(d.ID)
			ch := map[string]any{
				"type":  direction,
				"id":    chID,
				"label": d.ID,
			}
			if direction == "GPIOIN" {
				ch["bias"] = "pulldown"
				ch["debounceMs"] = 20
			}
			workflow.Channels = append(workflow.Channels, ch)
			gpioID := pickGPIOChip(target, bus)
			line := 0
			if d.Bus.Line != nil {
				line = *d.Bus.Line
			}
			mapping[chID] = ResourceBinding{Ref: gpioID, Index: &line}
			manifest.GPIOs[gpioID] = map[string]any{"chip": gpioID}

		case "serial":
			chID := "ch-uart-" + sanitize(d.ID)
			workflow.Channels = append(workflow.Channels, map[string]any{
				"type":  "UART",
				"id":    chID,
				"label": d.ID,
			})
			serID := pickSerial(target, bus)
			mapping[chID] = ResourceBinding{Ref: serID}
			serCfg := map[string]any{"device": serialDevice(target, bus)}
			if bus.Baud > 0 {
				serCfg["baud"] = bus.Baud
			}
			manifest.Serials[serID] = serCfg
		}
	}

	// 3. Nodes — minimal but engine-loadable. Per device-class one node;
	//    a single Agent driven by Ticker. Layout positions are computed
	//    from index for stable visual output in fh-builder.
	startupID := nodeID(spec.Name, "OnStartup", "boot")
	tickerID := nodeID(spec.Name, "Ticker", "agent")
	agentID := nodeID(spec.Name, "Agent", "reasoner")

	workflow.Nodes = append(workflow.Nodes,
		map[string]any{
			"id":   startupID,
			"type": "OnStartup",
			"position": map[string]any{"x": 0, "y": 0},
			"arguments": map[string]any{},
		},
		map[string]any{
			"id":   tickerID,
			"type": "Ticker",
			"position": map[string]any{"x": 0, "y": 120},
			"arguments": tickerArgs(spec.Agent.EvaluationEvery),
		},
		map[string]any{
			"id":   agentID,
			"type": "Agent",
			"position": map[string]any{"x": 300, "y": 60},
			"arguments": map[string]any{
				"name":               "site-agent",
				"model":              chosen.ID,
				"instructions":       buildAgentInstructions(spec, target),
				"maxTurns":           6,
				"answer":             map[string]any{"active": false, "mode": "emit", "name": "answer"},
				"outputDeclarations": []any{},
				"memoryRefs":         []any{},
			},
		},
	)

	// Boot edge: OnStartup → Agent (one-shot warmup).
	workflow.Edges = append(workflow.Edges, controlEdge(startupID, agentID))
	// Periodic edge: Ticker → Agent.
	workflow.Edges = append(workflow.Edges, controlEdge(tickerID, agentID))

	// 4. Per-device IO nodes.
	for i, d := range sortedDevices {
		bus := busByID[d.Bus.Ref]
		y := 240 + i*80
		switch bus.Type {
		case "mqtt":
			chID := "ch-mqtt-" + sanitize(d.ID)
			if d.Kind == "sensor" {
				id := nodeID(spec.Name, "OnMqttMessage", d.ID)
				dt := inferDataType(d)
				workflow.Nodes = append(workflow.Nodes, map[string]any{
					"id":   id,
					"type": "OnMqttMessage",
					"position": map[string]any{"x": 0, "y": y},
					"arguments": map[string]any{
						"channelReference": chID,
						"dataType":         dt,
						"output":           map[string]any{"active": true, "mode": "emit", "name": d.ID},
					},
				})
				workflow.Edges = append(workflow.Edges, controlEdge(id, agentID))
			} else if d.Kind == "actuator" {
				id := nodeID(spec.Name, "MqttPublish", d.ID)
				dt := inferDataType(d)
				workflow.Nodes = append(workflow.Nodes, map[string]any{
					"id":   id,
					"type": "MqttPublish",
					"position": map[string]any{"x": 600, "y": y},
					"arguments": map[string]any{
						"channelReference": chID,
						"dataType":         dt,
						"value":            literalExpr("", dt),
						"qos":              0,
						"retain":           false,
					},
				})
				workflow.Edges = append(workflow.Edges, agentToolEdge(agentID, id, fmt.Sprintf("Write to actuator %q (%s in zone %s)", d.ID, d.Controls, d.Zone)))
			}
		case "gpio":
			chID := "ch-gpio-" + sanitize(d.ID)
			if d.Kind == "sensor" {
				id := nodeID(spec.Name, "OnPinEdge", d.ID)
				workflow.Nodes = append(workflow.Nodes, map[string]any{
					"id":   id,
					"type": "OnPinEdge",
					"position": map[string]any{"x": 0, "y": y},
					"arguments": map[string]any{
						"pinReference": chID,
						"edge":         "both",
					},
				})
				workflow.Edges = append(workflow.Edges, controlEdge(id, agentID))
			} else if d.Kind == "actuator" {
				id := nodeID(spec.Name, "WritePin", d.ID)
				workflow.Nodes = append(workflow.Nodes, map[string]any{
					"id":   id,
					"type": "WritePin",
					"position": map[string]any{"x": 600, "y": y},
					"arguments": map[string]any{
						"pinReference": chID,
						"signalType":   "digital",
						"value":        literalExpr(false, "bool"),
					},
				})
				workflow.Edges = append(workflow.Edges, agentToolEdge(agentID, id, fmt.Sprintf("Drive GPIO actuator %q (%s)", d.ID, d.Controls)))
			}
		case "serial":
			chID := "ch-uart-" + sanitize(d.ID)
			if d.Kind == "sensor" {
				id := nodeID(spec.Name, "OnSerialReceive", d.ID)
				workflow.Nodes = append(workflow.Nodes, map[string]any{
					"id":   id,
					"type": "OnSerialReceive",
					"position": map[string]any{"x": 0, "y": y},
					"arguments": map[string]any{
						"portReference": chID,
						"output":        map[string]any{"active": true, "mode": "emit", "name": d.ID},
					},
				})
				workflow.Edges = append(workflow.Edges, controlEdge(id, agentID))
			} else if d.Kind == "actuator" {
				id := nodeID(spec.Name, "SerialWrite", d.ID)
				workflow.Nodes = append(workflow.Nodes, map[string]any{
					"id":   id,
					"type": "SerialWrite",
					"position": map[string]any{"x": 600, "y": y},
					"arguments": map[string]any{
						"portReference": chID,
						"value":         literalExpr("", "string"),
					},
				})
				workflow.Edges = append(workflow.Edges, agentToolEdge(agentID, id, fmt.Sprintf("Write to serial actuator %q", d.ID)))
			}
		}
	}

	// 5. Local-models.yaml — one endpoint, one model entry, capability list
	//    drawn from the target catalog.
	local := LocalModelsConfig{
		Endpoints: []LocalEndpoint{
			{
				URL: fmt.Sprintf("http://localhost:%d", target.SLMRuntime.ServePort),
				Models: []LocalModel{
					{
						ID:           chosen.ID,
						Capabilities: modelCapabilities(target, chosen.ID),
						Dimension:    modelDimension(target, chosen.ID),
					},
				},
			},
		},
	}

	return planResult{
		Workflow:       workflow,
		Mapping:        mapping,
		Resources:      resources,
		DeviceManifest: manifest,
		LocalModels:    local,
		BundleMetadata: BundleMetadata{
			SchemaVersion: 1,
			SpecName:      spec.Name,
			TargetID:      target.ID,
			TargetArch:    target.Arch,
			SLMRuntime:    target.SLMRuntime,
			ChosenModel: ChosenModel{
				ID:         chosen.ID,
				RAMMB:      chosen.RAMMB,
				GPURequest: target.SLMRuntime.GPURequest,
			},
		},
	}, diags
}

// pickReasoningModel returns the best-fit SLM for the requested capability
// or an error diag if none fit on the target.
func pickReasoningModel(spec *Spec, target *Target) (TargetSLM, []Diagnostic) {
	cands := suggestModels(target, spec.Agent.Reasoning.Capability, 0)
	if len(cands) == 0 {
		return TargetSLM{}, []Diagnostic{{
			Severity: "error",
			Category: "plan",
			Message: fmt.Sprintf("no SLM on target %q satisfies capability %q within %d MB available RAM",
				target.ID, spec.Agent.Reasoning.Capability, target.RAM.availableMB()),
			Location: "$.agent.reasoning.capability",
		}}
	}
	// Prefer the largest model that still fits — better quality than the
	// smallest. suggestModels returns smallest-first, so reverse-pick.
	return cands[len(cands)-1], nil
}

func modelCapabilities(t *Target, id string) []string {
	for _, m := range t.SLMs {
		if m.ID == id {
			return append([]string(nil), m.Capabilities...)
		}
	}
	return nil
}

func modelDimension(t *Target, id string) int {
	for _, m := range t.SLMs {
		if m.ID == id {
			return m.Dimension
		}
	}
	return 0
}

// pickGPIOChip returns the chip id either from the bus override or the
// target's first gpiochip. Errors are handled later in validate.
func pickGPIOChip(t *Target, b Bus) string {
	if b.Chip != "" {
		return b.Chip
	}
	if len(t.Hardware.GPIOs) > 0 {
		return t.Hardware.GPIOs[0].ID
	}
	return "gpiochip0"
}

func pickSerial(t *Target, b Bus) string {
	if b.Device != "" {
		return "uart-" + sanitize(b.ID)
	}
	if len(t.Hardware.Serials) > 0 {
		return t.Hardware.Serials[0].ID
	}
	return "uart-default"
}

func serialDevice(t *Target, b Bus) string {
	if b.Device != "" {
		return b.Device
	}
	if len(t.Hardware.Serials) > 0 {
		return t.Hardware.Serials[0].Device
	}
	return "/dev/ttyUSB0"
}

func mqttResource(b Bus) map[string]any {
	out := map[string]any{
		"type":      "mqtt",
		"brokerUrl": b.BrokerURL,
	}
	if b.Username != "" {
		out["username"] = b.Username
	}
	if b.Password != "" {
		out["password"] = b.Password
	}
	return out
}

func controlEdge(from, to string) map[string]any {
	return map[string]any{
		"id":   "e-ctrl-" + shortHash(from+"->"+to),
		"type": "control",
		"from": map[string]any{"nodeId": from, "port": "ctrl"},
		"to":   map[string]any{"nodeId": to, "port": "ctrl"},
	}
}

// agentToolEdge wires a tool node onto the agent. The contract requires
// every agentTask edge to carry a `prompt` Expression — that is the
// LLM-readable description of what the tool does.
func agentToolEdge(from, to, description string) map[string]any {
	return map[string]any{
		"id":     "e-tool-" + shortHash(from+"->"+to),
		"type":   "agentTask",
		"from":   map[string]any{"nodeId": from, "port": "tool"},
		"to":     map[string]any{"nodeId": to, "port": "ctrl"},
		"prompt": literalExpr(description, "string"),
	}
}

// literalExpr builds a workflow.Expression with no variable references —
// a constant value the agent fills in at tool-call time (or that the engine
// uses as a default).
func literalExpr(value any, dataType string) map[string]any {
	expr := fmt.Sprintf("%v", value)
	if expr == "" {
		switch dataType {
		case "float", "int":
			expr = "0"
		case "bool":
			expr = "false"
		default:
			expr = `""`
		}
	}
	return map[string]any{
		"expression": expr,
		"references": []any{},
		"dataType":   dataType,
	}
}

// tickerArgs splits "60s" / "5m" / "100ms" / "1h" into intervalValue +
// intervalUnit as the contract requires. Falls back to 60 seconds.
func tickerArgs(s string) map[string]any {
	if s == "" {
		return map[string]any{"intervalValue": 60, "intervalUnit": "seconds"}
	}
	unit := "seconds"
	body := s
	switch {
	case strings.HasSuffix(s, "ms"):
		unit, body = "milliseconds", strings.TrimSuffix(s, "ms")
	case strings.HasSuffix(s, "s"):
		unit, body = "seconds", strings.TrimSuffix(s, "s")
	case strings.HasSuffix(s, "m"):
		unit, body = "minutes", strings.TrimSuffix(s, "m")
	case strings.HasSuffix(s, "h"):
		unit, body = "hours", strings.TrimSuffix(s, "h")
	}
	n := 0
	for _, c := range body {
		if c < '0' || c > '9' {
			return map[string]any{"intervalValue": 60, "intervalUnit": "seconds"}
		}
		n = n*10 + int(c-'0')
	}
	if n == 0 {
		n = 60
	}
	return map[string]any{"intervalValue": n, "intervalUnit": unit}
}

// nodeID derives a stable id from spec name + node type + discriminator.
// Same input → same id; agents can diff plan outputs across runs cleanly.
func nodeID(specName, nodeType, disc string) string {
	return nodeType + "_" + shortHash(specName+"|"+nodeType+"|"+disc)
}

func shortHash(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:6])
}

// sanitize maps an arbitrary id into [a-z0-9-] for use in channel/resource
// identifiers.
func sanitize(s string) string {
	out := make([]byte, 0, len(s))
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out = append(out, byte(r))
		case r == '-', r == '_', r == ' ', r == '.':
			out = append(out, '-')
		}
	}
	return string(out)
}

func parseEvery(s string) int {
	if s == "" {
		return 60_000
	}
	mult := 1000
	body := s
	switch {
	case strings.HasSuffix(s, "ms"):
		mult, body = 1, strings.TrimSuffix(s, "ms")
	case strings.HasSuffix(s, "s"):
		mult, body = 1000, strings.TrimSuffix(s, "s")
	case strings.HasSuffix(s, "m"):
		mult, body = 60_000, strings.TrimSuffix(s, "m")
	case strings.HasSuffix(s, "h"):
		mult, body = 3_600_000, strings.TrimSuffix(s, "h")
	}
	n := 0
	for _, c := range body {
		if c < '0' || c > '9' {
			return 60_000
		}
		n = n*10 + int(c-'0')
	}
	if n == 0 {
		return 60_000
	}
	return n * mult
}

// inferDataType maps a device's unit/measurement to a workflow DataType.
func inferDataType(d Device) string {
	if d.Unit != "" {
		return "float"
	}
	switch d.Measures {
	case "temperature", "humidity", "co2", "pressure", "voltage", "current":
		return "float"
	case "presence", "open", "closed":
		return "bool"
	case "text", "command":
		return "string"
	}
	switch d.Controls {
	case "light", "valve":
		return "bool"
	}
	return "string"
}

// buildAgentInstructions composes the reasoning agent's system prompt from
// the spec's goals, constraints, devices, and user hint. Deterministic order.
func buildAgentInstructions(spec *Spec, target *Target) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("You are the on-device agent for the site %q running on a %s.\n", spec.Name, target.DisplayName))
	if spec.Description != "" {
		sb.WriteString(spec.Description + "\n")
	}
	if len(spec.Goals) > 0 {
		sb.WriteString("\nGoals:\n")
		for _, g := range spec.Goals {
			sb.WriteString(fmt.Sprintf("- (%s) %s\n", g.ID, g.Description))
		}
	}
	if len(spec.Constraints) > 0 {
		sb.WriteString("\nHard constraints (do not violate):\n")
		for _, c := range spec.Constraints {
			sb.WriteString(fmt.Sprintf("- (%s) %s\n", c.ID, c.Description))
		}
	}
	sortedDevs := append([]Device(nil), spec.Devices...)
	sort.Slice(sortedDevs, func(i, j int) bool { return sortedDevs[i].ID < sortedDevs[j].ID })
	if len(sortedDevs) > 0 {
		sb.WriteString("\nDevices available:\n")
		for _, d := range sortedDevs {
			role := d.Measures
			if d.Kind == "actuator" {
				role = d.Controls
			}
			zone := d.Zone
			if zone == "" {
				zone = "—"
			}
			sb.WriteString(fmt.Sprintf("- %s [%s, %s, zone=%s]\n", d.ID, d.Kind, role, zone))
		}
	}
	if hint := strings.TrimSpace(spec.Agent.Reasoning.PromptHint); hint != "" {
		sb.WriteString("\nAdditional guidance:\n")
		sb.WriteString(hint)
		sb.WriteString("\n")
	}
	return sb.String()
}

// ---------- artifact writers (deterministic) ----------

func writePlanArtifacts(dir string, p planResult) error {
	if err := writeStableJSON(filepath.Join(dir, "agent.workflow.json"), p.Workflow); err != nil {
		return err
	}
	if err := writeStableJSON(filepath.Join(dir, "site.mapping.json"), p.Mapping); err != nil {
		return err
	}
	if err := writeStableJSON(filepath.Join(dir, "device.manifest.json"), p.DeviceManifest); err != nil {
		return err
	}
	if err := writeStableYAML(filepath.Join(dir, "site.resources.yaml"), p.Resources); err != nil {
		return err
	}
	if err := writeStableYAML(filepath.Join(dir, "local-models.yaml"), p.LocalModels); err != nil {
		return err
	}
	if err := writeStableJSON(filepath.Join(dir, "bundle.meta.json"), p.BundleMetadata); err != nil {
		return err
	}
	return nil
}

// writeStableJSON writes JSON with sorted map keys and stable indentation.
// json.Marshal already sorts map keys; for nested maps we round-trip through
// json.RawMessage to normalize key order recursively.
func writeStableJSON(path string, v any) error {
	buf, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal %s: %w", path, err)
	}
	// Round-trip via decode-into-interface{} → re-marshal, which sorts
	// nested map keys (encoding/json sorts only top-level map keys, but
	// not deeply-nested maps inside slices of any).
	var generic any
	if err := json.Unmarshal(buf, &generic); err != nil {
		return fmt.Errorf("renormalize %s: %w", path, err)
	}
	sorted, err := json.MarshalIndent(generic, "", "  ")
	if err != nil {
		return fmt.Errorf("re-marshal %s: %w", path, err)
	}
	return os.WriteFile(path, append(sorted, '\n'), 0o644)
}

func writeStableYAML(path string, v any) error {
	buf, err := yaml.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal %s: %w", path, err)
	}
	return os.WriteFile(path, buf, 0o644)
}
