package node

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/ForestHubAI/fh-core/go/api/workflow"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
	"github.com/ForestHubAI/fh-core/go/llmproxy/agent"
	"github.com/ForestHubAI/fh-core/go/llmproxy/schemautil"

	"github.com/ForestHubAI/fh-core/go/util/pointer"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/expr"
	"github.com/ForestHubAI/fh-core/go/engine/logging"
	"github.com/ForestHubAI/fh-core/go/engine/memory"
)

// Implementation guards
var _ engine.Executable = (*Agent)(nil)
var _ engine.Emitter = (*Agent)(nil)
var _ engine.ToolProvider = (*Agent)(nil)
var _ engine.HasSetup = (*Agent)(nil)

// agentAnswerOutID is the ID used for the agent's free-form "answer" output.
const agentAnswerOutID = "answer"

// Agent executes an LLM agent via llmproxy.
type Agent struct {
	engine.BranchingNode
	name            string
	instructions    string
	answerBinding   workflow.OutputBinding       // binding for the agent's free-form "answer" slot
	outputDecl      []workflow.OutputDeclaration // user-declared outputs (each carries its own routing via ApplyDeclaration)
	memoryRefs      []workflow.MemoryRef         // memory files the LLM may read/write, with per-ref access mode
	memory          *memory.Manager              // engine-scoped memory subsystem; may be nil if no refs are wired
	runner          *agent.Runner                // pre-built (model + max_turns fixed)
	options         *llmproxy.Options            // generation options; nil for provider defaults
	toolDescription string                       // description used when this agent is wired as a tool to another agent
	tools           []engine.ToolProvider        // tools wired to this agent at build time
	// Built once in Setup (after wiring)
	agent              *agent.Agent
	structuredResponse bool // Whether the agent needs to produce a structured JSON response (vs plain text)
}

// AddTool registers a ToolProvider wired to this agent. Called by the builder
// when wiring tool edges.
func (n *Agent) AddTool(t engine.ToolProvider) { n.tools = append(n.tools, t) }

// NewAgent constructs a new Agent node. memoryRefs lists the memory files
// the LLM is permitted to access at runtime; `mem` is the engine-scoped
// manager that backs read/append/edit. Both may be empty/nil for agents
// without memory. toolDescription is only consulted when this agent is
// wired as a tool to another agent.
func NewAgent(
	id string,
	name string,
	model string,
	instructions *string,
	answer workflow.OutputBinding,
	outputDecls []workflow.OutputDeclaration,
	memoryRefs []workflow.MemoryRef,
	maxTurns *int,
	toolDescription string,
	client engine.LlmClient,
	mem *memory.Manager,
) *Agent {
	runnerOpts := []agent.RunnerOption{
		agent.WithLogger(logging.Logger.With().Str("node", id).Logger()),
	}
	if maxTurns != nil && *maxTurns > 0 {
		runnerOpts = append(runnerOpts, agent.WithMaxTurns(*maxTurns))
	}
	runner := agent.NewRunner(client, llmproxy.ModelID(model), runnerOpts...)

	return &Agent{
		BranchingNode:   engine.NewBranchingNode(id),
		name:            name,
		instructions:    pointer.Val(instructions),
		answerBinding:   answer,
		outputDecl:      outputDecls,
		memoryRefs:      memoryRefs,
		memory:          mem,
		runner:          runner,
		toolDescription: toolDescription,
	}
}

func (n *Agent) Outputs() map[string]workflow.DataType {
	out := make(map[string]workflow.DataType)
	// Add answer slot if it's emitted
	if n.answerBinding.Mode == workflow.OutputBindingModeEmit {
		out[agentAnswerOutID] = workflow.String
	}
	// Add emit-mode declarations
	for _, od := range n.outputDecl {
		if od.Mode == workflow.OutputDeclarationModeEmit {
			// Asserts that uid is non-nil when mode=emit
			out[*od.Uid] = od.DataType
		}
	}
	return out
}

// Setup is called by the builder after all edges (including tool edges) are
// wired but before Execute can fire. It materialises the llmproxy agent:
// tool list, response format, and full instructions are all fixed at this point.
func (n *Agent) Setup(_ context.Context) error {
	if err := memory.ValidateRefs(n.memoryRefs, n.memory); err != nil {
		return fmt.Errorf("agent %s: %w", n.ID(), err)
	}

	branches := n.Transitions(engine.PortCtrl)
	// Both multiple branches and declared outputs require a structured response format
	n.structuredResponse = len(branches) > 1 || len(n.outputDecl) > 0

	// Build the agent
	instructions := n.instructions
	if len(branches) > 1 {
		prompt, err := buildBranchingPrompt(branches)
		if err != nil {
			return fmt.Errorf("agent %s: %w", n.ID(), err)
		}
		instructions += prompt
	}

	// Build the memory index card and append to system instructions.
	// This ensures the model sees the declared memory files
	memCard, err := memory.IndexCard(n.memoryRefs, n.memory)
	if err != nil {
		return fmt.Errorf("agent %s: %w", n.ID(), err)
	}
	instructions += memCard
	opts := []agent.Option{agent.WithInstructions(instructions)}

	// Build tools
	tools, err := n.buildTools()
	if err != nil {
		return fmt.Errorf("agent %s: %w", n.ID(), err)
	}
	// Append memory read / readWrite tools if memory refs are present
	memToolList, err := memory.Tools(n.memoryRefs, n.memory)
	if err != nil {
		return fmt.Errorf("agent %s: %w", n.ID(), err)
	}
	tools = append(tools, memToolList...)
	// If any, add tools to agent
	if len(tools) > 0 {
		opts = append(opts, agent.WithTools(tools...))
	}

	if n.structuredResponse {
		opts = append(opts, agent.WithResponseFormat(n.buildResponseFormat()))
	}
	if n.options != nil {
		opts = append(opts, agent.WithOptions(n.options))
	}

	n.agent = agent.NewAgent(n.name, opts...)
	return nil
}

// Execute invokes the agent and returns the next state.
func (n *Agent) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	if len(scope.GetConversation()) == 0 {
		return "", fmt.Errorf("agent %s: missing conversation context on scope", n.ID())
	}
	res, err := n.runner.Run(ctx, n.agent, llmproxy.Input(scope.GetConversation()))
	if err != nil {
		return "", fmt.Errorf("agent %s: %w", n.ID(), err)
	}
	answer, ok := res.FinalOutput.(string)
	if !ok {
		return "", fmt.Errorf("agent %s: expected string output, got %T", n.ID(), res.FinalOutput)
	}

	// Plain text path: no response format — the whole text is the answer.
	// Only one or none transition can exist on control port, no branching.
	if !n.structuredResponse {
		if err := engine.ApplyOutput(scope, n.ID(), agentAnswerOutID, n.answerBinding, expr.StringVal(answer)); err != nil {
			return "", fmt.Errorf("agent %s: applying answer: %w", n.ID(), err)
		}
		return n.next(scope, "")
	}

	// Structured path: parse JSON, extract answer + declared outputs. Branching may exist.
	var parsed map[string]any
	if err := json.Unmarshal([]byte(answer), &parsed); err != nil {
		return "", fmt.Errorf("agent %s: invalid JSON response: %w", n.ID(), err)
	}
	if err := n.applyStructuredOutputs(scope, parsed); err != nil {
		return "", fmt.Errorf("agent %s: %w", n.ID(), err)
	}
	choice, _ := parsed["choice"].(string) // Falls through as empty string if no branching is needed
	return n.next(scope, choice)
}

// next resolves and applies the outgoing transition. `choice` is the model-
// emitted token ("choice_N") — consulted only when multiple branches exist,
// ignored otherwise. Tokens are opaque to the model; the branching prompt
// carries the legend mapping each token to its branch description.
func (n *Agent) next(scope *engine.Scope, choice string) (string, error) {
	branches := n.Transitions(engine.PortCtrl)
	if len(branches) == 0 {
		return engine.StateIdle, nil
	}
	if len(branches) == 1 {
		tr := branches[0]
		if err := tr.Apply(scope); err != nil {
			return "", fmt.Errorf("agent %s: applying transition: %w", n.ID(), err)
		}
		return tr.TargetID, nil
	}
	idx, err := parseChoiceToken(choice, len(branches))
	if err != nil {
		return "", fmt.Errorf("agent %s: %w", n.ID(), err)
	}
	tr := branches[idx]
	desc := ""
	if tr.Description != nil {
		desc = *tr.Description
	}
	if err := tr.Apply(scope); err != nil {
		return "", fmt.Errorf("agent %s: applying branch %s (%s): %w", n.ID(), choice, desc, err)
	}
	return tr.TargetID, nil
}

// choiceToken is the opaque enum value placed in the response schema for the
// branch at index i. Kept short and stable so the model can reproduce it reliably.
func choiceToken(i int) string { return "choice_" + strconv.Itoa(i) }

// parseChoiceToken extracts the branch index from a choice_N token and
// verifies it is within range.
func parseChoiceToken(token string, branchCount int) (int, error) {
	const prefix = "choice_"
	rest, ok := strings.CutPrefix(token, prefix)
	if !ok {
		return 0, fmt.Errorf("invalid choice token %q", token)
	}
	idx, err := strconv.Atoi(rest)
	if err != nil || idx < 0 || idx >= branchCount {
		return 0, fmt.Errorf("invalid choice token %q", token)
	}
	return idx, nil
}

// Tools exposes this Agent as an LLM-callable tool. Following the llmproxy
// agent.AsTool convention, the tool accepts a single "prompt" string and
// returns the agent's final answer.
func (n *Agent) Tools() ([]llmproxy.FunctionTool, error) {
	type inputPrompt struct {
		Prompt string `json:"prompt"`
	}
	runAgent := func(ctx context.Context, args inputPrompt) (any, error) {
		if n.agent == nil {
			return nil, fmt.Errorf("agent %s: not set up", n.ID())
		}
		res, err := n.runner.Run(ctx, n.agent, llmproxy.InputString(args.Prompt))
		if err != nil {
			return nil, fmt.Errorf("agent %s: %w", n.ID(), err)
		}
		return res.FinalOutput, nil
	}
	ft, err := llmproxy.NewFunctionTool(n.name, n.toolDescription, runAgent)
	if err != nil {
		return nil, fmt.Errorf("agent %s: %w", n.ID(), err)
	}
	return []llmproxy.FunctionTool{ft}, nil
}

// buildTools collects every function tool contributed by the attached providers.
func (n *Agent) buildTools() ([]llmproxy.Tool, error) {
	if len(n.tools) == 0 {
		return nil, nil
	}
	var tools []llmproxy.Tool
	for _, t := range n.tools {
		fts, err := t.Tools()
		if err != nil {
			return nil, fmt.Errorf("building tool %w", err)
		}
		for _, ft := range fts {
			tools = append(tools, ft)
		}
	}
	return tools, nil
}

// buildResponseFormat constructs the JSON schema covering "answer", each
// declared output (keyed by name), and a "choice" enum for multi-branch agents.
// Built at runtime because the set of declared outputs and branches is not known at compile time.
func (n *Agent) buildResponseFormat() *llmproxy.ResponseFormat {
	properties := map[string]any{
		"answer": map[string]any{"type": "string"},
	}
	for _, od := range n.outputDecl {
		properties[od.Name] = map[string]any{"type": engine.JSONTypeFor(od.DataType)}
	}
	branches := n.Transitions(engine.PortCtrl)
	if len(branches) > 1 {
		enumValues := make([]string, 0, len(branches))
		for i := range branches {
			enumValues = append(enumValues, choiceToken(i))
		}
		properties["choice"] = map[string]any{
			"type": "string",
			"enum": enumValues,
		}
	}
	return &llmproxy.ResponseFormat{
		Name:   n.ID() + "_output",
		Schema: schemautil.StrictObject(properties),
	}
}

// applyStructuredOutputs extracts the answer + each declared output from the
// parsed JSON and routes each value to its destination. "answer" goes through
// ApplyOutput (it's a proper slot on the agent node); declared outputs go
// through ApplyDeclaration (emit → new var under this node, assign → existing ref).
func (n *Agent) applyStructuredOutputs(scope *engine.Scope, parsed map[string]any) error {
	answer, _ := parsed["answer"].(string)
	if err := engine.ApplyOutput(scope, n.ID(), agentAnswerOutID, n.answerBinding, expr.StringVal(answer)); err != nil {
		return fmt.Errorf("applying answer: %w", err)
	}
	for _, od := range n.outputDecl {
		raw, ok := parsed[od.Name]
		if !ok {
			return fmt.Errorf("missing declared output %q in agent response", od.Name)
		}
		val, err := expr.Coerce(od.DataType, raw)
		if err != nil {
			return fmt.Errorf("output %q: %w", od.Name, err)
		}
		if err := engine.ApplyDeclaration(scope, n.ID(), od, val); err != nil {
			return fmt.Errorf("applying output %s: %w", od.Name, err)
		}
	}
	return nil
}

// buildBranchingPrompt appends a "choose one of" instruction block to steer
// the model toward populating the "choice" field. Emits the token→description
// legend so the model knows which opaque choice_N corresponds to which branch.
func buildBranchingPrompt(branches []engine.Transition) (string, error) {
	var sb strings.Builder
	sb.WriteString("\n\nYou must set the \"choice\" field to exactly one of the following tokens. Each token maps to a branch:\n")
	for i, tr := range branches {
		if tr.Description == nil {
			return "", fmt.Errorf("branch %s (target %s) has no description", choiceToken(i), tr.TargetID)
		}
		fmt.Fprintf(&sb, "- %q: %s\n", choiceToken(i), *tr.Description)
	}
	return sb.String(), nil
}
