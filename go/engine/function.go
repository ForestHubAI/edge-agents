// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Function is a compiled, callable sub-workflow. Synchronous, no triggers.
type Function struct {
	Info              workflowapi.FunctionInfo
	DeclaredVars      []workflowapi.Variable            // function-local declared variables to seed into the function scope at call time
	EntryTransition   Transition                        // OnFunctionCall edge's transition: TargetID is the entry node, its side effect (e.g. an AgentTask prompt) is applied against the fresh call scope before that node runs
	Executables       map[string]Executable             // executable nodes, keyed by node id
	OutputAssignments map[string]workflowapi.Expression // return uid → expression evaluated in callee scope at end
}

// Call runs the function in a fresh FunctionScope and returns
// the computed return values keyed by return uid.
func (f *Function) Call(ctx context.Context, args map[string]expr.Value) (map[string]expr.Value, error) {
	fs, err := NewFunctionScope(f.DeclaredVars, args)
	if err != nil {
		return nil, fmt.Errorf("function %s: %w", f.Info.Name, err)
	}
	// Seed function scope with node outputs
	for _, a := range f.Executables {
		if em, ok := a.(Emitter); ok {
			RegisterNodeOutputs(fs, em)
		}
	}

	// Seed the call scope with the entry edge's side effects (e.g. an AgentTask
	// prompt) before the entry node runs, evaluated against the freshly-seeded
	// args. A zero transition is a no-op.
	if err := f.EntryTransition.Apply(fs); err != nil {
		return nil, fmt.Errorf("function %s: entry transition: %w", f.Info.Name, err)
	}

	// Run the function scoped state machine until it returns to idle (must be
	// acyclic — a cycle here would otherwise hang this Call, and with it the
	// state-runner, forever; the ctx check keeps such a loop cancellable).
	state := f.EntryTransition.TargetID
	for state != StateIdle {
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("function %s: %w", f.Info.Name, ctx.Err())
		default:
		}
		node, ok := f.Executables[state]
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
