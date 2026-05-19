package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
	"github.com/ForestHubAI/fh-core/go/llmproxy/schemautil"
)

// Tools synthesizes the LLM-callable tools (read_memory, append_memory,
// edit_memory) for the given memory refs. Each tool's `file` parameter is
// constrained by enum to the human names of files this agent is allowed to
// touch (read-only refs excluded from write enums). Internally, each tool
// resolves the chosen name to its uid before calling the manager.
//
// Returns nil when refs is empty.
func Tools(refs []api.MemoryRef, mgr *Manager) ([]llmproxy.Tool, error) {
	if len(refs) == 0 {
		return nil, nil
	}
	if mgr == nil {
		return nil, fmt.Errorf("memory refs present but no memory manager configured")
	}

	readByName := map[string]string{} // name → uid
	writeByName := map[string]string{}
	for _, r := range refs {
		card, err := mgr.Card(r.Uid)
		if err != nil {
			return nil, fmt.Errorf("memory ref %q: %w", r.Uid, err)
		}
		readByName[card.Name] = r.Uid
		if r.Mode == api.Rw {
			writeByName[card.Name] = r.Uid
		}
	}

	tools := []llmproxy.Tool{newReadTool(readByName, mgr)}
	if len(writeByName) > 0 {
		tools = append(tools, newAppendTool(writeByName, mgr), newEditTool(writeByName, mgr))
	}
	return tools, nil
}

// IndexCard renders the auto-injected memory index block prepended to the
// LLM agent's system prompt. One line per file with name, mode, size, and
// description so the LLM can decide what to fetch.
func IndexCard(refs []api.MemoryRef, mgr *Manager) (string, error) {
	if len(refs) == 0 {
		return "", nil
	}
	if mgr == nil {
		return "", fmt.Errorf("memory refs present but no memory manager configured")
	}

	cards := make([]Card, 0, len(refs))
	modes := make(map[string]api.MemoryRefMode, len(refs))
	for _, r := range refs {
		c, err := mgr.Card(r.Uid)
		if err != nil {
			return "", fmt.Errorf("memory ref %q: %w", r.Uid, err)
		}
		cards = append(cards, c)
		modes[r.Uid] = r.Mode
	}
	sort.Slice(cards, func(i, j int) bool { return cards[i].Name < cards[j].Name })

	var sb strings.Builder
	sb.WriteString("\n\n## Memory files available\n")
	sb.WriteString("Fetch their content via read_memory(file). ")
	sb.WriteString("Modify writable files via append_memory / edit_memory.\n")
	for _, c := range cards {
		mode := "R"
		if modes[c.UID] == api.Rw {
			mode = "RW"
		}
		fmt.Fprintf(&sb, "- %s (%s, %dB): %s\n", c.Name, mode, c.SizeBytes, c.Description)
	}
	return sb.String(), nil
}

// ValidateRefs checks that every ref's uid is present in the manager. Run
// at Setup() time so a misconfigured workflow fails the build instead of
// failing at the first LLM tool call.
func ValidateRefs(refs []api.MemoryRef, mgr *Manager) error {
	if len(refs) == 0 {
		return nil
	}
	if mgr == nil {
		return fmt.Errorf("memory refs present but no memory manager configured")
	}
	known := make(map[string]struct{}, len(mgr.UIDs()))
	for _, u := range mgr.UIDs() {
		known[u] = struct{}{}
	}
	for _, r := range refs {
		if _, ok := known[r.Uid]; !ok {
			return fmt.Errorf("memory ref %q: file is not declared on the workflow", r.Uid)
		}
	}
	return nil
}

// --- per-tool factories ---

type readArgs struct {
	File string `json:"file"`
}

// enumNames returns the sorted keys of a name→uid map for use as a JSON
// schema enum. The sort is stable across calls so the schema doesn't churn.
func enumNames(byName map[string]string) []string {
	out := make([]string, 0, len(byName))
	for k := range byName {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func newReadTool(byName map[string]string, mgr *Manager) llmproxy.FunctionTool {
	return llmproxy.FunctionTool{
		ExternalToolBase: llmproxy.ExternalToolBase{
			Name:        "read_memory",
			Description: "Read the full current content of one memory file. Use the file name as it appears in the memory index.",
			Parameters: schemautil.StrictObject(map[string]any{
				"file": map[string]any{"type": "string", "enum": enumNames(byName)},
			}),
		},
		ToolCall: func(_ context.Context, raw json.RawMessage) (any, error) {
			var args readArgs
			if err := json.Unmarshal(raw, &args); err != nil {
				return nil, fmt.Errorf("read_memory: parse args: %w", err)
			}
			uid, ok := byName[args.File]
			if !ok {
				return nil, fmt.Errorf("read_memory: file %q not available", args.File)
			}
			content, err := mgr.Read(uid)
			if err != nil {
				return nil, mapErr("read_memory", err)
			}
			return content, nil
		},
	}
}

type appendArgs struct {
	File    string `json:"file"`
	Content string `json:"content"`
}

func newAppendTool(byName map[string]string, mgr *Manager) llmproxy.FunctionTool {
	return llmproxy.FunctionTool{
		ExternalToolBase: llmproxy.ExternalToolBase{
			Name:        "append_memory",
			Description: "Append the given content to the end of one memory file. Preserves existing content. Follow the format conventions in the file's description.",
			Parameters: schemautil.StrictObject(map[string]any{
				"file":    map[string]any{"type": "string", "enum": enumNames(byName)},
				"content": map[string]any{"type": "string"},
			}),
		},
		ToolCall: func(ctx context.Context, raw json.RawMessage) (any, error) {
			var args appendArgs
			if err := json.Unmarshal(raw, &args); err != nil {
				return nil, fmt.Errorf("append_memory: parse args: %w", err)
			}
			uid, ok := byName[args.File]
			if !ok {
				return nil, fmt.Errorf("append_memory: file %q not writable", args.File)
			}
			if err := mgr.Append(ctx, uid, args.Content); err != nil {
				return nil, mapErr("append_memory", err)
			}
			return "ok", nil
		},
	}
}

type editArgs struct {
	File      string `json:"file"`
	OldString string `json:"old_string"`
	NewString string `json:"new_string"`
}

func newEditTool(byName map[string]string, mgr *Manager) llmproxy.FunctionTool {
	return llmproxy.FunctionTool{
		ExternalToolBase: llmproxy.ExternalToolBase{
			Name:        "edit_memory",
			Description: "Replace the first occurrence of old_string with new_string in one memory file. If old_string isn't found the call fails — re-read the file and retry with a string that actually appears.",
			Parameters: schemautil.StrictObject(map[string]any{
				"file":       map[string]any{"type": "string", "enum": enumNames(byName)},
				"old_string": map[string]any{"type": "string"},
				"new_string": map[string]any{"type": "string"},
			}),
		},
		ToolCall: func(ctx context.Context, raw json.RawMessage) (any, error) {
			var args editArgs
			if err := json.Unmarshal(raw, &args); err != nil {
				return nil, fmt.Errorf("edit_memory: parse args: %w", err)
			}
			uid, ok := byName[args.File]
			if !ok {
				return nil, fmt.Errorf("edit_memory: file %q not writable", args.File)
			}
			if err := mgr.Edit(ctx, uid, args.OldString, args.NewString); err != nil {
				return nil, mapErr("edit_memory", err)
			}
			return "ok", nil
		},
	}
}

// mapErr translates manager errors into LLM-facing messages so the model
// gets actionable guidance (re-read, compact, etc.) instead of an opaque
// internal failure.
func mapErr(tool string, err error) error {
	switch {
	case errors.Is(err, ErrEditNoMatch):
		return fmt.Errorf("%s: the supplied old_string was not found in the file; re-read it and retry", tool)
	case errors.Is(err, ErrSizeExceeded):
		return fmt.Errorf("%s: this write would exceed the file's size cap; remove or compact existing content first", tool)
	case errors.Is(err, ErrFileNotFound):
		return fmt.Errorf("%s: file is not available to this agent", tool)
	default:
		return fmt.Errorf("%s: %w", tool, err)
	}
}
