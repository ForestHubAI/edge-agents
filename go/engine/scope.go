package engine

import (
	"fmt"

	"github.com/ForestHubAI/fh-core/go/api/workflow"

	"github.com/ForestHubAI/fh-core/go/engine/expr"
	"github.com/ForestHubAI/fh-core/go/llmproxy"
)

// Well-known source IDs used in context variable lookups and expression references.
const (
	// SrcDeclared is the source ID for user-declared variables.
	SrcDeclared = "declared"
	// SrcFnArg is the source ID reserved for function-argument references.
	// References with this source ID resolve against a function Call's arguments rather than against any scope variable.
	SrcFnArg = "fnarg"
)

func contextKey(srcId, varId string) string { return srcId + ":" + varId }

// Scope holds runtime variables and conversation state for workflow execution.
// Scope is single-threaded: after Setup, only the state-runner modifies scope.
// Cross-goroutine delivery to trigger goroutines happens through the channels Subscribe() returns
type Scope struct {
	Vars         map[string]expr.Value        // Holds variable sof all sources, separated by srcID
	subscribers  map[string][]chan expr.Value // Registered listeners for variable updates, keyed by srcID:varID
	Conversation llmproxy.InputItems
}

// NewMainScope creates a scope for the main workflow, initialized with the given declared variables.
func NewMainScope(declaredVars []workflow.Variable) (*Scope, error) {
	s := &Scope{Vars: make(map[string]expr.Value), subscribers: make(map[string][]chan expr.Value)}
	if err := s.initialize(declaredVars); err != nil {
		return nil, fmt.Errorf("seeding main scope declared variables: %w", err)
	}
	return s, nil
}

// NewFunctionScope creates an isolated scope for function execution, with the
// given arguments pre-seeded under SrcFnArg and initialized declared variables.
func NewFunctionScope(declaredVars []workflow.Variable, args map[string]expr.Value) (*Scope, error) {
	// Set up function scope with args
	vars := make(map[string]expr.Value, len(args))
	for argUid, v := range args {
		vars[contextKey(SrcFnArg, argUid)] = v
	}
	s := &Scope{Vars: vars, subscribers: make(map[string][]chan expr.Value)}
	// Seed declared variables
	if err := s.initialize(declaredVars); err != nil {
		return nil, fmt.Errorf("seeding function scope declared variables: %w", err)
	}
	return s, nil
}

// Resolve implements expr.VarResolver.
func (s *Scope) Resolve(ref workflow.Reference) (expr.Value, error) {
	v, ok := s.Vars[contextKey(ref.SrcId, ref.VarId)]
	if !ok {
		return expr.Value{}, fmt.Errorf("unresolved reference %s:%s", ref.SrcId, ref.VarId)
	}
	return v, nil
}

// Set updates the value of a variable in the scope and notifies subscribers.
func (s *Scope) Set(srcId, varId string, v expr.Value) {
	key := contextKey(srcId, varId)
	s.Vars[key] = v
	for _, ch := range s.subscribers[key] {
		select {
		case ch <- v:
		default:
		}
	}
}

func (s *Scope) GetConversation() llmproxy.InputItems { return s.Conversation }
func (s *Scope) SetConversation(in llmproxy.Input)    { s.Conversation = llmproxy.AsInputItems(in) }

// Subscribe returns a buffered channel that receives a value every time the variable is Set.
// Only subscribe during Setup, or you'll race the state-runner
func (s *Scope) Subscribe(srcId, varId string) <-chan expr.Value {
	key := contextKey(srcId, varId)
	ch := make(chan expr.Value, SubBufSize)
	s.subscribers[key] = append(s.subscribers[key], ch)
	return ch
}

// RegisterNodeOutputs declares zero values for an emitter node's outputs into the scope.
func RegisterNodeOutputs(scp *Scope, em Emitter) {
	for id, dt := range em.Outputs() {
		scp.Set(em.ID(), id, expr.ZeroValue(dt))
	}
}

// ApplyOutput stores a value into the scope according to the binding mode.
func ApplyOutput(s *Scope, nodeID, slotID string, binding workflow.OutputBinding, val expr.Value) error {
	if !binding.Active {
		return nil
	}
	switch binding.Mode {
	case workflow.OutputBindingModeEmit:
		s.Set(nodeID, slotID, val)
	case workflow.OutputBindingModeAssign:
		if binding.Target == nil {
			return fmt.Errorf("assign binding for %s:%s has no target", nodeID, slotID)
		}
		s.Set(binding.Target.SrcId, binding.Target.VarId, val)
	}
	return nil
}

// ApplyDeclaration stores a value into the scope according to the declaration mode.
func ApplyDeclaration(s *Scope, nodeID string, od workflow.OutputDeclaration, val expr.Value) error {
	switch od.Mode {
	case workflow.OutputDeclarationModeEmit:
		if od.Uid == nil {
			return fmt.Errorf("emit declaration %q on node %s missing uid", od.Name, nodeID)
		}
		s.Set(nodeID, *od.Uid, val)
	case workflow.OutputDeclarationModeAssign:
		if od.Target == nil {
			return fmt.Errorf("assign declaration on node %s missing target", nodeID)
		}
		s.Set(od.Target.SrcId, od.Target.VarId, val)
	default:
		return fmt.Errorf("declaration on node %s: unknown mode %q", nodeID, od.Mode)
	}
	return nil
}

// initialize declares and sets user-declared variables in the scope.
func (s *Scope) initialize(vars []workflow.Variable) error {
	for _, v := range vars {
		val, err := expr.Coerce(v.DataType, v.InitialValue)
		if err != nil {
			return fmt.Errorf("declared variable %q: %w", v.Uid, err)
		}
		s.Set(SrcDeclared, v.Uid, val)
	}
	return nil
}
