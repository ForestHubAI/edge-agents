// Command fh-agent compiles a site.spec.yaml into a deploy-ready
// edge-agents bundle (workflow + mapping + resources + device manifest +
// local-models config + compose stack).
//
// Pipeline: spec → plan → validate → build.
//
// All subcommands emit structured JSON on --json and exit non-zero on
// diagnostics. The contract is documented in this command's README.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
)

const usage = `fh-agent — compile a site.spec.yaml into a deployable edge-agent bundle.

Authoring (read/write files only):
  fh-agent spec init [--out site.spec.yaml]
  fh-agent spec schema [--json]
  fh-agent spec validate <spec.yaml> [--json]

Introspection (read-only, embedded data):
  fh-agent targets list [--json]
  fh-agent targets describe <id> [--json]
  fh-agent capabilities [--json]
  fh-agent models suggest --target <id> --capability <cap> [--max-ram-mb N] [--json]

Compilation:
  fh-agent plan <spec.yaml> --target <id> --out <build-dir>
  fh-agent validate <build-dir> [--json]
  fh-agent build <build-dir> --name <site-name> --out <dist-dir> [--tar]

Exit codes:
  0  ok
  1  diagnostics (spec/plan/validate finding the user must fix)
  2  infrastructure (IO error, embedded data corrupted)
  64 usage error
`

func main() {
	if len(os.Args) < 2 {
		fmt.Fprint(os.Stderr, usage)
		os.Exit(exitUsage)
	}
	cmd := os.Args[1]
	args := os.Args[2:]
	switch cmd {
	case "spec":
		runSpec(args)
	case "targets":
		runTargets(args)
	case "capabilities":
		runCapabilities(args)
	case "models":
		runModels(args)
	case "plan":
		runPlan(args)
	case "validate":
		runValidate(args)
	case "build":
		runBuild(args)
	case "-h", "--help", "help":
		fmt.Print(usage)
	case "version", "--version", "-v":
		fmt.Println("fh-agent v0.1.0")
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n%s", cmd, usage)
		os.Exit(exitUsage)
	}
}

// ----- spec subcommand -----

func runSpec(args []string) {
	if len(args) == 0 {
		die(exitUsage, "spec subcommand required (init|schema|validate)")
	}
	switch args[0] {
	case "init":
		runSpecInit(args[1:])
	case "schema":
		runSpecSchema(args[1:])
	case "validate":
		runSpecValidate(args[1:])
	default:
		die(exitUsage, "unknown spec subcommand: %s", args[0])
	}
}

func runSpecInit(args []string) {
	fs := flag.NewFlagSet("spec init", flag.ExitOnError)
	out := fs.String("out", "site.spec.yaml", "destination path")
	_ = fs.Parse(args)
	if _, err := os.Stat(*out); err == nil {
		die(exitInfra, "%s already exists — refusing to overwrite", *out)
	}
	if err := os.WriteFile(*out, []byte(specInitTemplate), 0o644); err != nil {
		die(exitInfra, "write %s: %v", *out, err)
	}
	fmt.Fprintf(os.Stderr, "wrote %s\n", *out)
}

func runSpecSchema(args []string) {
	fs := flag.NewFlagSet("spec schema", flag.ExitOnError)
	asJSON := fs.Bool("json", true, "emit JSON (currently the only format)")
	_ = fs.Parse(args)
	_ = asJSON // schema is JSON by definition; flag kept for symmetry
	os.Stdout.Write(SpecSchema())
}

func runSpecValidate(args []string) {
	fs := flag.NewFlagSet("spec validate", flag.ExitOnError)
	_ = fs.Bool("json", true, "emit JSON diagnostics")
	pos := parseMixed(fs, args)
	if len(pos) < 1 {
		die(exitUsage, "usage: fh-agent spec validate <spec.yaml>")
	}
	s, err := LoadSpec(pos[0])
	if err != nil {
		emitDiags(os.Stderr, []Diagnostic{{Severity: "error", Category: "spec", Message: err.Error()}})
		os.Exit(exitDiagnostics)
	}
	diags := ValidateSpec(s)
	emitDiags(os.Stderr, diags)
	if hasError(diags) {
		os.Exit(exitDiagnostics)
	}
}

// ----- targets subcommand -----

func runTargets(args []string) {
	if len(args) == 0 {
		die(exitUsage, "targets subcommand required (list|describe)")
	}
	switch args[0] {
	case "list":
		runTargetsList(args[1:])
	case "describe":
		runTargetsDescribe(args[1:])
	default:
		die(exitUsage, "unknown targets subcommand: %s", args[0])
	}
}

func runTargetsList(args []string) {
	fs := flag.NewFlagSet("targets list", flag.ExitOnError)
	asJSON := fs.Bool("json", false, "emit JSON")
	_ = fs.Parse(args)
	ts, err := listTargets()
	if err != nil {
		die(exitInfra, "load targets: %v", err)
	}
	if *asJSON {
		type row struct {
			ID          string `json:"id"`
			DisplayName string `json:"displayName"`
			Arch        string `json:"arch"`
			RAMMB       int    `json:"ramMB"`
			Accel       string `json:"accel"`
		}
		out := make([]row, 0, len(ts))
		for _, t := range ts {
			out = append(out, row{t.ID, t.DisplayName, t.Arch, t.RAM.TotalMB, t.Accel.Type})
		}
		writeJSON(os.Stdout, out)
		return
	}
	for _, t := range ts {
		fmt.Printf("%-26s  %-8s  %5d MB  accel=%-6s  %s\n", t.ID, t.Arch, t.RAM.TotalMB, t.Accel.Type, t.DisplayName)
	}
}

func runTargetsDescribe(args []string) {
	fs := flag.NewFlagSet("targets describe", flag.ExitOnError)
	_ = fs.Bool("json", true, "emit JSON (only format in v1)")
	pos := parseMixed(fs, args)
	if len(pos) < 1 {
		die(exitUsage, "usage: fh-agent targets describe <id>")
	}
	t, err := getTarget(pos[0])
	if err != nil {
		die(exitDiagnostics, "%v", err)
	}
	writeJSON(os.Stdout, t)
}

// ----- capabilities subcommand -----

func runCapabilities(args []string) {
	fs := flag.NewFlagSet("capabilities", flag.ExitOnError)
	_ = fs.Bool("json", true, "emit JSON")
	_ = fs.Parse(args)
	caps := struct {
		BusTypes       []string `json:"busTypes"`
		DeviceKinds    []string `json:"deviceKinds"`
		LLMCapabilities []string `json:"llmCapabilities"`
		ContractVersion int      `json:"contractWorkflowSchemaVersion"`
		Notes          string   `json:"notes"`
	}{
		BusTypes:        []string{"mqtt", "gpio", "serial"},
		DeviceKinds:     []string{"sensor", "actuator", "controller"},
		LLMCapabilities: []string{"chat", "reasoning", "classification", "embedding", "function_call", "vision", "code"},
		ContractVersion: 1,
		Notes:           "v1 bus types map to engine channel types MQTT, GPIO (digital pin), UART (serial). I2C/SPI/HTTP/CtrlX-Data-Layer planned for later versions.",
	}
	writeJSON(os.Stdout, caps)
}

// ----- models subcommand -----

func runModels(args []string) {
	if len(args) == 0 {
		die(exitUsage, "models subcommand required (suggest)")
	}
	switch args[0] {
	case "suggest":
		runModelsSuggest(args[1:])
	default:
		die(exitUsage, "unknown models subcommand: %s", args[0])
	}
}

func runModelsSuggest(args []string) {
	fs := flag.NewFlagSet("models suggest", flag.ExitOnError)
	targetID := fs.String("target", "", "hardware target id")
	cap := fs.String("capability", "", "required capability (chat|reasoning|embedding|...)")
	maxRAM := fs.Int("max-ram-mb", 0, "optional hard RAM cap; 0 = use target available")
	_ = fs.Bool("json", true, "emit JSON")
	_ = fs.Parse(args)
	if *targetID == "" || *cap == "" {
		die(exitUsage, "usage: fh-agent models suggest --target <id> --capability <cap>")
	}
	t, err := getTarget(*targetID)
	if err != nil {
		die(exitDiagnostics, "%v", err)
	}
	out := suggestModels(t, *cap, *maxRAM)
	writeJSON(os.Stdout, out)
}

// parseMixed parses args allowing flags and positional args in any order.
// stdlib flag stops at the first non-flag arg; we loop, collect positionals,
// and re-parse the remainder until exhausted. Returns positional args.
func parseMixed(fs *flag.FlagSet, args []string) []string {
	var positional []string
	for len(args) > 0 {
		_ = fs.Parse(args)
		rem := fs.Args()
		if len(rem) == 0 {
			break
		}
		positional = append(positional, rem[0])
		args = rem[1:]
	}
	return positional
}

// writeJSON emits indented, stable JSON to w. All Maps in inputs must have
// string keys (Go's json encoder sorts those alphabetically — gives us
// deterministic output for free).
func writeJSON(w *os.File, v any) {
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		die(exitInfra, "encode JSON: %v", err)
	}
}
