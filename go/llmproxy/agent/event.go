package agent

import "github.com/ForestHubAI/fh-core/go/llmproxy"

// EventType identifies the kind of event emitted during agent execution.
type EventType string

const (
	EventMessage    EventType = "message"
	EventToolCall   EventType = "tool_call"
	EventToolResult EventType = "tool_result"
	EventFinal      EventType = "final"
)

// Event represents an occurrence during agent execution.
// The runner emits all event types. Errors are not emitted as events — they are returned
// as Go errors and the caller (handler) decides how to surface them (e.g. as SSE error events).
type Event struct {
	Type       EventType
	Turn       int                       // current turn (1-based)
	Text       string                    // message / final output
	ToolCall   *llmproxy.ToolCallRequest // tool_call only
	ToolResult *llmproxy.ToolResult      // tool_result only
}

// EventHandler receives events during agent execution.
type EventHandler func(Event)
