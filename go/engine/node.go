package engine

import (
	"context"
	"fmt"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
)

const (
	PortCtrl  = "ctrl"
	PortTrue  = "true"
	PortFalse = "false"
)

// ===== Node Contracts =====

// Wirable is the basic wiring contract every workflow object (action or trigger)
// satisfies: it has an ID and can accept outgoing edges.
type Wirable interface {
	ID() string
	AddTransition(port string, tr Transition) error
}

// Trigger is the contract for nodes that produce events from
// their own goroutine. The runner constructs one goroutine per Trigger and
// drives the lifecycle.
type Trigger interface {
	Wirable

	// Wait blocks until the trigger fires or ctx cancels, then returns the
	// event or error.
	Wait(ctx context.Context) (Event, error)

	// Close releases resources on shutdown. Runner calls this even if Setup
	// failed partway, so implementations should guard nil fields.
	Close() error
}

// Executable is implemented by action nodes that run on the state-runner goroutine.
type Executable interface {
	Wirable
	Execute(ctx context.Context, scope *Scope) (nextState string, err error)
}

// Emitter marks nodes that can emit variables to a scope
type Emitter interface {
	Wirable
	// Outputs returns the output a node does actually emit (bindingMode = emit)
	Outputs() map[string]api.DataType
}

// HasSetup is implemented by nodes that need ctx-bound, fallible initialization
type HasSetup interface {
	Setup(ctx context.Context) error
}

// FilterEmitted filters raw declared output slots to only those whose binding
// is emit-mode (or unbound, which defaults to emit). Used by EmitsVariables
// implementations to produce the seedable slot map.
func FilterEmitted(raw map[string]api.DataType, bindings map[string]api.OutputBinding) map[string]api.DataType {
	out := make(map[string]api.DataType, len(raw))
	for slotID, dt := range raw {
		b, ok := bindings[slotID]
		if !ok || b.Mode == api.OutputBindingModeEmit {
			out[slotID] = dt
		}
	}
	return out
}

// ToolProvider marks nodes that can be exposed as LLM tools to agent nodes.
// A single ToolProvider may contribute one or more LLM-callable function tools.
// Descriptions live on the implementing node; either hardcoded, or carried
// as a node argument.
type ToolProvider interface {
	Tools() ([]llmproxy.FunctionTool, error)
}

// ===== Embeddable base types =====

// LinearNode is embedded by nodes with at most one target per port
type LinearNode struct {
	id          string
	transitions map[string]Transition // port → transition
}

// NewLinearNode creates a new LinearNode
func NewLinearNode(id string) LinearNode {
	return LinearNode{id: id, transitions: make(map[string]Transition)}
}

func (b *LinearNode) ID() string { return b.id }
func (b *LinearNode) AddTransition(port string, tr Transition) error {
	if _, ok := b.transitions[port]; ok {
		return fmt.Errorf("node %s: duplicate transition on port %s", b.id, port)
	}
	b.transitions[port] = tr
	return nil
}

// Next applies the outgoing transition's side effects (e.g. AgentTask prompt
// evaluation) against the scope and returns the target node ID. Returns
// StateIdle with a nil error when no transition is wired to the port.
func (b *LinearNode) Next(port string, scope *Scope) (string, error) {
	tr, ok := b.transitions[port]
	if !ok {
		return StateIdle, nil
	}
	if err := tr.Apply(scope); err != nil {
		return "", fmt.Errorf("node %s port %s: %w", b.id, port, err)
	}
	return tr.TargetID, nil
}

// BranchingNode is a base for a node that can decide between multiple
// state transitions per port (e.g. LLM agent)
type BranchingNode struct {
	id          string
	transitions map[string][]Transition
}

// NewBranchingNode creates a new BranchingNode
func NewBranchingNode(id string) BranchingNode {
	return BranchingNode{id: id, transitions: make(map[string][]Transition)}
}

func (b *BranchingNode) ID() string { return b.id }
func (b *BranchingNode) AddTransition(port string, tr Transition) error {
	b.transitions[port] = append(b.transitions[port], tr)
	return nil
}
func (b *BranchingNode) Transitions(port string) []Transition { return b.transitions[port] }

// ToolNode is embedded by tool-only nodes that never participate in the state machine
type ToolNode struct {
	id string
}

// NewToolNode creates a new ToolNode
func NewToolNode(id string) ToolNode {
	return ToolNode{id: id}
}

func (b *ToolNode) ID() string { return b.id }
func (b *ToolNode) AddTransition(port string, _ Transition) error {
	return fmt.Errorf("node %s: tool nodes cannot accept state transitions (port %q)", b.id, port)
}

// TriggerNode is the common embed for every trigger
type TriggerNode struct {
	id     string
	target string
}

// NewTriggerNode creates a new TriggerNode
func NewTriggerNode(id string) TriggerNode { return TriggerNode{id: id} }

func (b *TriggerNode) ID() string     { return b.id }
func (b *TriggerNode) Target() string { return b.target }
func (b *TriggerNode) AddTransition(_ string, tr Transition) error {
	if b.target != "" {
		return fmt.Errorf("trigger %s: already has target %q", b.id, b.target)
	}
	b.target = tr.TargetID
	return nil
}
