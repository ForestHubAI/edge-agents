// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"context"
	"errors"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine/expr"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeAction is a minimal Executable that runs a user-supplied func against
// the scope and returns the configured next state. Used to drive Function tests
// without dragging the node package in.
type fakeAction struct {
	id      string
	next    string
	run     func(*Scope) error
	outputs map[string]workflowapi.DataType
}

func (a *fakeAction) ID() string                               { return a.id }
func (a *fakeAction) AddTransition(string, Transition) error   { return nil }
func (a *fakeAction) Outputs() map[string]workflowapi.DataType { return a.outputs }
func (a *fakeAction) Execute(_ context.Context, s *Scope) (string, error) {
	if a.run != nil {
		if err := a.run(s); err != nil {
			return "", err
		}
	}
	return a.next, nil
}

func TestFunction_Call(t *testing.T) {
	t.Run("happy path: evaluates output expressions over function scope", func(t *testing.T) {
		// Action stores arg "a" multiplied by 2 into a declared variable "result".
		action := &fakeAction{
			id:   "double",
			next: StateIdle,
			run: func(s *Scope) error {
				v, err := s.Resolve(workflowapi.Reference{SrcId: SrcFnArg, VarId: "a"})
				if err != nil {
					return err
				}
				s.Set(SrcDeclared, "result", expr.IntVal(v.AsInt()*2))
				return nil
			},
		}
		fn := &Function{
			Info: workflowapi.FunctionInfo{
				Name: "double",
				Id:   "fn1",
				Arguments: []workflowapi.Variable{
					{Uid: "a", DataType: workflowapi.Int},
				},
				Returns: []workflowapi.Variable{
					{Uid: "ret", Name: "value", DataType: workflowapi.Int},
				},
			},
			DeclaredVars: []workflowapi.Variable{
				{Uid: "result", DataType: workflowapi.Int},
			},
			EntryTransition: Transition{TargetID: "double"},
			Actions:         map[string]Executable{"double": action},
			OutputAssignments: map[string]workflowapi.Expression{
				"ret": {
					Expression: "${}",
					DataType:   workflowapi.Int,
					References: []workflowapi.Reference{{SrcId: SrcDeclared, VarId: "result"}},
				},
			},
		}

		out, err := fn.Call(context.Background(), map[string]expr.Value{"a": expr.IntVal(7)})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(14), out["ret"])
	})

	t.Run("missing output assignment errors", func(t *testing.T) {
		fn := &Function{
			Info: workflowapi.FunctionInfo{
				Name:    "f",
				Returns: []workflowapi.Variable{{Uid: "ret", Name: "value", DataType: workflowapi.Int}},
			},
			EntryTransition:   Transition{TargetID: StateIdle},
			Actions:           map[string]Executable{},
			OutputAssignments: map[string]workflowapi.Expression{}, // missing
		}

		_, err := fn.Call(context.Background(), nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing output assignment")
	})

	t.Run("missing node id during execution errors", func(t *testing.T) {
		fn := &Function{
			Info:              workflowapi.FunctionInfo{Name: "f"},
			EntryTransition:   Transition{TargetID: "ghost"},
			Actions:           map[string]Executable{}, // no node "ghost"
			OutputAssignments: map[string]workflowapi.Expression{},
		}
		_, err := fn.Call(context.Background(), nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "ghost")
		assert.Contains(t, err.Error(), "not found")
	})

	t.Run("action error is wrapped with function and node names", func(t *testing.T) {
		action := &fakeAction{
			id: "boom",
			run: func(*Scope) error {
				return errors.New("kaboom")
			},
		}
		fn := &Function{
			Info:              workflowapi.FunctionInfo{Name: "f"},
			EntryTransition:   Transition{TargetID: "boom"},
			Actions:           map[string]Executable{"boom": action},
			OutputAssignments: map[string]workflowapi.Expression{},
		}
		_, err := fn.Call(context.Background(), nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "function f")
		assert.Contains(t, err.Error(), "boom")
		assert.Contains(t, err.Error(), "kaboom")
	})

	t.Run("emitter outputs are pre-registered with zero values", func(t *testing.T) {
		// The action reads its own slot (which must exist as zero before it ran)
		// to prove RegisterNodeOutputs ran.
		action := &fakeAction{
			id:      "emit",
			next:    StateIdle,
			outputs: map[string]workflowapi.DataType{"slot": workflowapi.Int},
			run: func(s *Scope) error {
				v, err := s.Resolve(workflowapi.Reference{SrcId: "emit", VarId: "slot"})
				if err != nil {
					return err
				}
				if v != expr.IntVal(0) {
					return errors.New("expected zero value")
				}
				return nil
			},
		}
		fn := &Function{
			Info:              workflowapi.FunctionInfo{Name: "f"},
			EntryTransition:   Transition{TargetID: "emit"},
			Actions:           map[string]Executable{"emit": action},
			OutputAssignments: map[string]workflowapi.Expression{},
		}
		_, err := fn.Call(context.Background(), nil)
		require.NoError(t, err)
	})

	t.Run("function scope seeding error propagates", func(t *testing.T) {
		fn := &Function{
			Info: workflowapi.FunctionInfo{Name: "bad"},
			DeclaredVars: []workflowapi.Variable{
				{Uid: "x", DataType: workflowapi.Int, InitialValue: "not int"},
			},
			EntryTransition: Transition{TargetID: StateIdle},
		}
		_, err := fn.Call(context.Background(), nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "function bad")
	})

	// An OnFunctionCall edge feeding an
	// agent must seed the conversation before the entry node runs. The prompt
	// evaluates against the fresh call scope, so it can reference the call args.
	t.Run("entry transition seeds conversation before entry node", func(t *testing.T) {
		var seen llmproxy.InputItems
		entry := &fakeAction{
			id:   "agent",
			next: StateIdle,
			run: func(sc *Scope) error {
				seen = sc.GetConversation()
				return nil
			},
		}
		fn := &Function{
			Info: workflowapi.FunctionInfo{
				Name:      "f",
				Arguments: []workflowapi.Variable{{Uid: "a", Name: "a", DataType: workflowapi.String}},
			},
			EntryTransition: Transition{
				TargetID: "agent",
				EdgeType: workflowapi.AgentTask,
				Prompt: pointer.Ptr(workflowapi.Expression{
					Expression: "summarize ${}",
					DataType:   workflowapi.String,
					References: []workflowapi.Reference{{SrcId: SrcFnArg, VarId: "a"}},
				}),
			},
			Actions:           map[string]Executable{"agent": entry},
			OutputAssignments: map[string]workflowapi.Expression{},
		}

		_, err := fn.Call(context.Background(), map[string]expr.Value{"a": expr.StringVal("the report")})
		require.NoError(t, err)
		require.Len(t, seen, 1, "entry node ran without a seeded conversation")
		assert.Equal(t, "summarize the report", seen[0].String())
	})
}
