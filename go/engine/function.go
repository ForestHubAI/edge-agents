package engine

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Function is a compiled, callable sub-workflow. Synchronous, no triggers.
type Function struct {
	Info              workflow.FunctionInfo
	DeclaredVars      []workflow.Variable            // function-local declared variables to seed into the function scope at call time
	InitialState      string                         // entry node id (from OnFunctionCall's outgoing edge)
	Actions           map[string]Executable          // action nodes, keyed by node id
	OutputAssignments map[string]workflow.Expression // return uid → expression evaluated in callee scope at end
}

// Call runs the function in a fresh FunctionScope and returns
// the computed return values keyed by return uid.
func (f *Function) Call(ctx context.Context, args map[string]expr.Value) (map[string]expr.Value, error) {
	fs, err := NewFunctionScope(f.DeclaredVars, args)
	if err != nil {
		return nil, fmt.Errorf("function %s: %w", f.Info.Name, err)
	}
	// Seed function scope with node outputs
	for _, a := range f.Actions {
		if em, ok := a.(Emitter); ok {
			RegisterNodeOutputs(fs, em)
		}
	}

	// Run the function scoped state machine until it returns to idle (must be acyclic).
	state := f.InitialState
	for state != StateIdle {
		node, ok := f.Actions[state]
		if !ok {
			return nil, fmt.Errorf("function %s: node %q not found", f.Info.Name, state)
		}
		next, err := node.Execute(ctx, fs)
		if err != nil {
			return nil, fmt.Errorf("function %s: node %s: %w", f.Info.Name, state, err)
		}
		state = next
	}

	// Evaluate output expressions using the function scope and return.
	out := make(map[string]expr.Value, len(f.OutputAssignments))
	for _, ret := range f.Info.Returns {
		e, ok := f.OutputAssignments[ret.Uid]
		if !ok {
			return nil, fmt.Errorf("function %s: missing output assignment for return %s", f.Info.Name, ret.Name)
		}
		v, err := expr.Eval(e, fs)
		if err != nil {
			return nil, fmt.Errorf("function %s: output assignment %s: %w", f.Info.Name, ret.Name, err)
		}
		out[ret.Uid] = v
	}
	return out, nil
}
