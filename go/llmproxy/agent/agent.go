// Package agent defines concepts for agentic applications
package agent

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

// Agent represents an LLM agent with a set of tools and instructions.
// It encapsulates the agent's identity, behavior guidelines, and available functionalities.
// Can be reused across different LLM providers, models and runs.
type Agent struct {
	// Name is the name of the agent.
	Name string `json:"name"`

	// Instructions act as system prompt and are the behavior guidelines for the agent.
	Instructions string `json:"instructions,omitempty"`

	// ResponseFormat defines the structured response format the agent should use if provided.
	ResponseFormat *llmproxy.ResponseFormat `json:"responseFormat,omitempty"`

	// Tools is the list of tools available to the agent (including handoff tools).
	Tools []llmproxy.Tool `json:"tools,omitempty"`

	// Options carries per-agent generation knobs (temperature, max_tokens, etc.) that
	// the runner copies into each ChatRequest. Nil means provider defaults.
	Options *llmproxy.Options `json:"options,omitempty"`
}

// NewAgent creates a new Agent with the given name and applies any provided options.
func NewAgent(name string, opts ...Option) *Agent {
	a := &Agent{Name: name}
	for _, opt := range opts {
		opt(a)
	}
	return a
}

// Option defines a configuration option for Agent.
type Option func(*Agent)

// WithInstructions sets the Instructions field of the Agent.
func WithInstructions(instructions string) Option {
	return func(a *Agent) {
		a.Instructions = instructions
	}
}

// WithResponseFormat sets the ResponseFormat field of the Agent.
func WithResponseFormat(format *llmproxy.ResponseFormat) Option {
	return func(a *Agent) {
		a.ResponseFormat = format
	}
}

// WithTools sets the Tools field of the Agent.
func WithTools(tools ...llmproxy.Tool) Option {
	return func(a *Agent) {
		a.Tools = tools
	}
}

// WithOptions sets per-agent generation options (copied into each ChatRequest by the runner).
func WithOptions(opts *llmproxy.Options) Option {
	return func(a *Agent) {
		a.Options = opts
	}
}

// AsTool converts the Agent into a Tool that can be used by other agents.
// The tool, when called, runs the agent with the provided input prompt and returns the final output.
//
// runner: The Runner instance to use for executing the agent when called as a tool. This allows the agent to be
// invoked with its own execution context, configuration like model or max turns, and state management.
func (a *Agent) AsTool(name, description string, runner *Runner) (llmproxy.Tool, error) {
	// Agent tools can only be called with a single string prompt as input
	type inputPrompt struct {
		Prompt string `json:"prompt"`
	}

	// Define function that is run if tool is called
	runAgent := func(ctx context.Context, args inputPrompt) (any, error) {
		res, err := runner.Run(ctx, a, llmproxy.InputString(args.Prompt))
		if err != nil {
			return nil, fmt.Errorf("failed to run agent %s as tool: %w", a.Name, err)
		}
		return res.FinalOutput, nil
	}

	// Create as function tool
	ft, err := llmproxy.NewFunctionTool(name, description, runAgent)
	if err != nil {
		return nil, fmt.Errorf("failed to create function tool for agent %s: %w", a.Name, err)
	}
	return ft, nil
}

// FindExternalTool searches for an ExternalTool by name in the agent's tools.
func FindExternalTool(a *Agent, name string) (llmproxy.ExternalTool, bool) {
	for _, t := range a.Tools {
		if t.ToolName() == name {
			et, ok := t.(llmproxy.ExternalTool)
			return et, ok
		}
	}
	return nil, false
}
