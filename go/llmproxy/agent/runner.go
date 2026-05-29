package agent

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/rs/zerolog"
)

// Runner executes agents using the configured RunConfig.
type Runner struct {
	llmClient    llmClient
	DefaultModel llmproxy.ModelID
	MaxTurns     *int
	eventHandler EventHandler
	logger       zerolog.Logger // defaults to zerolog.Nop() — silent for backend in-process callers
}

// NewRunner creates a new Runner with the given model.
func NewRunner(client llmClient, model llmproxy.ModelID, opts ...RunnerOption) *Runner {
	r := &Runner{
		llmClient:    client,
		DefaultModel: model,
		logger:       zerolog.Nop(),
	}
	for _, opt := range opts {
		opt(r)
	}
	return r
}

// RunnerOption defines a configuration option for Runner.
type RunnerOption func(*Runner)

// WithMaxTurns sets the maximum number of turns the agent can take before stopping.
// This does not include turns taken by sub-agents called as tools.
func WithMaxTurns(n int) RunnerOption {
	return func(r *Runner) {
		r.MaxTurns = &n
	}
}

// WithEventHandler sets a callback that receives events during agent execution.
func WithEventHandler(h EventHandler) RunnerOption {
	return func(r *Runner) {
		r.eventHandler = h
	}
}

// WithLogger sets the structured logger used to emit Activity events
// ("llm_generate" per turn, "agent_run" on success). When unset, the runner
// stays silent — backend in-process callers (e.g. /llm/test-agent SSE) rely
// on this to avoid spurious agent_activity rows.
func WithLogger(l zerolog.Logger) RunnerOption {
	return func(r *Runner) {
		r.logger = l
	}
}

// emit sends an event to the event handler if one is configured.
func (r Runner) emit(e Event) {
	if r.eventHandler != nil {
		r.eventHandler(e)
	}
}

// RunResult contains the result of running an agent/workflow.
type RunResult struct {
	// FinalOutput is the output of the last agent.
	FinalOutput any

	// LastAgent is the agent that produced the final output.
	LastAgent *Agent

	// Turns is the number of turns (LLM invocations) taken by the runner.
	// This does not include turns taken by sub-agents called as tools.
	Turns int
}

// Run executes a workflow starting at the given agent. The agent runs in a loop until a final
// output is generated or the maximum number of turns is reached.
//
// Loop steps:
//  1. Invoke the current agent with input.
//  2. If a final output is produced (structured: any text; plain: text and no tool calls), return.
//  3. If a handoff occurs, switch agent/model and continue with same context.
//  4. If tool calls are present, execute them and update input for the next turn.
//  5. Repeat until final output or max turns.
//
// Returns an error if neither output nor tool calls are produced, or if max turns is exceeded.
func (r Runner) Run(ctx context.Context, startingAgent *Agent, input llmproxy.Input) (*RunResult, error) {
	if startingAgent == nil {
		return nil, fmt.Errorf("startingAgent can not be nil")
	}
	currentAgent := startingAgent
	currentModel := r.DefaultModel
	currentInput := llmproxy.AsInputItems(input)

	for turn := 0; r.MaxTurns == nil || turn < *r.MaxTurns; turn++ {
		// Run the current agent
		req := &llmproxy.ChatRequest{
			Model:          currentModel,
			Input:          currentInput,
			SystemPrompt:   currentAgent.Instructions,
			ResponseFormat: currentAgent.ResponseFormat,
			Tools:          currentAgent.Tools,
			Options:        currentAgent.Options,
		}
		res, err := r.llmClient.Chat(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("error running agent %s: %w", currentAgent.Name, err)
		}
		r.logger.Info().
			Str("action", "llm_generate").
			Str("summary", fmt.Sprintf("%s · %d tokens", currentModel, res.TokensUsed)).
			Str("agent", currentAgent.Name).
			Str("model", string(currentModel)).
			Int("turn", turn+1).
			Int("tokensUsed", res.TokensUsed).
			Int("inputTokens", res.InputTokens).
			Int("outputTokens", res.OutputTokens).
			Str("responseId", res.ResponseID).
			Str("prompt", truncate(llmproxy.LastUserInput(req.Input), 200)).
			Str("response", truncate(res.Text, 200)).
			Msg("llm.generate")

		// Check if the model produced a final output.
		// If a response format is set (structured output), any non-empty text is considered final.
		// If no response format is set (plain text), only treat as final if there are no tool calls.
		if res.Text != "" {
			if req.ResponseFormat != nil || len(res.ToolCallRequests) == 0 {
				result := &RunResult{
					FinalOutput: res.Text,
					LastAgent:   currentAgent,
					Turns:       turn + 1,
				}
				r.emit(Event{Type: EventFinal, Turn: result.Turns, Text: res.Text})
				r.logger.Info().
					Str("action", "agent_run").
					Str("summary", fmt.Sprintf("%s · %d turns", result.LastAgent.Name, result.Turns)).
					Str("agent", result.LastAgent.Name).
					Int("turns", result.Turns).
					Msg("agent.run.complete")
				return result, nil
			}
			// Non-final text (model produced text alongside tool calls)
			r.emit(Event{Type: EventMessage, Turn: turn + 1, Text: res.Text})
		}

		// If there are no tool calls and no final output, this is an unexpected state.
		// If we want to support "run again" behavior (e.g. reasoning only turn), we could just
		// continue here instead.
		if len(res.ToolCallRequests) == 0 {
			return nil, fmt.Errorf("agent produced neither final output nor tool calls: %s", currentAgent.Name)
		}

		// Tool calls are present, so run the tools and append their requests/results to the input for the next turn.
		// If a handoff is encountered, switch agents immediately (ignoring any tool results of the same turn).
		handoff, newInputItems, err := executeFunctionTools(ctx, res.ToolCallRequests, currentAgent, turn+1, r.emit)
		if err != nil {
			return nil, err
		}
		// If a handoff is present, switch agents immediately (ignoring any tool results of same turn).
		if handoff != nil {
			currentAgent = handoff.Agent
			// Resume with default model if no new model specified by handoff
			currentModel = r.DefaultModel
			if handoff.Model != nil {
				currentModel = *handoff.Model
			}
			continue
		}
		// No handoff, continue with same agent, appending tool calls/results to input for next turn
		currentInput = append(currentInput, newInputItems...)
	}
	// Max turns exceeded
	return nil, fmt.Errorf("max turns exceeded")
}

// truncate returns s shortened to maxLen runes with an ellipsis suffix when cut.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "…"
}

// executeFunctionTools runs the given function tool calls using the tools available to the current agent.
func executeFunctionTools(ctx context.Context, requests []llmproxy.ToolCallRequest, currentAgent *Agent, turn int, emit func(Event)) (*Handoff, llmproxy.InputItems, error) {
	newInputItems := llmproxy.InputItems{}
	for _, req := range requests {
		tool, ok := FindExternalTool(currentAgent, req.Name)
		if !ok {
			return nil, nil, fmt.Errorf("tool %s not found for agent %s", req.Name, currentAgent.Name)
		}
		switch ft := tool.(type) {
		case llmproxy.FunctionTool:
			// Add tool call itself to conversation input, so model knows what was called
			newInputItems = append(newInputItems, req)
			emit(Event{Type: EventToolCall, Turn: turn, ToolCall: &req})
			// Call the tool function and get the result
			toolResult, err := ft.ToolCall(ctx, req.Arguments)
			if err != nil {
				return nil, nil, fmt.Errorf("error invoking tool %s: %w", req.Name, err)
			}
			// Add tool result to conversation input
			ftr := llmproxy.ToolResult{
				CallID: req.CallID,
				Name:   ft.ToolName(),
				Output: toolResult,
			}
			newInputItems = append(newInputItems, ftr)
			emit(Event{Type: EventToolResult, Turn: turn, ToolResult: &ftr})
		case Handoff:
			// Handoffs are control flow changes. No tool requests, results or turns.
			return &ft, nil, nil
		default:
			return nil, nil, fmt.Errorf("unsupported function tool type %T for tool %s", ft, req.Name)
		}
	}
	return nil, newInputItems, nil
}
