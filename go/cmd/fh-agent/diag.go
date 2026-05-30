package main

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// Diagnostic is the structured-error shape every fh-agent subcommand emits.
// Same fields, same JSON tags as fh-workflow validate, so agents only need
// one parser across the whole CLI surface.
type Diagnostic struct {
	Severity string `json:"severity"` // error | warn | info
	Category string `json:"category"` // spec | plan | validate | build
	Message  string `json:"message"`
	Location string `json:"location,omitempty"` // JSONPath into the offending file
	NodeID   string `json:"nodeId,omitempty"`   // workflow node id when relevant
}

// hasError returns true if any diagnostic is severity=error.
func hasError(ds []Diagnostic) bool {
	for _, d := range ds {
		if d.Severity == "error" {
			return true
		}
	}
	return false
}

// emitDiags writes diagnostics as a JSON array on stderr. Caller picks the
// exit code — usually 1 if hasError, 0 otherwise.
func emitDiags(w io.Writer, ds []Diagnostic) {
	if ds == nil {
		ds = []Diagnostic{}
	}
	buf, _ := json.MarshalIndent(ds, "", "  ")
	fmt.Fprintln(w, string(buf))
}

// Exit codes are part of the CLI contract — agents key off them. Document
// any change in the README.
const (
	exitOK          = 0
	exitDiagnostics = 1 // user-correctable: spec error, validation finding
	exitInfra       = 2 // engine unreachable, missing toolchain, IO failure
	exitUsage       = 64
)

func die(code int, format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(code)
}
