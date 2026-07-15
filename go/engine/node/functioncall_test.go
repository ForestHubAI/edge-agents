// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// passthroughFn returns a Function with one Int arg "a" and one Int return "ret"
// where ret = a (passthrough). InitialState is idle so Function.Call evaluates
// only the OutputAssignments — no actions required.
func passthroughFn() *engine.Function {
	return &engine.Function{
		Info: workflowapi.FunctionInfo{
			Id:   "fn1",
			Name: "passthrough",
			Arguments: []workflowapi.Variable{
				{Uid: "a", Name: "a", DataType: workflowapi.Int},
			},
			Returns: []workflowapi.Variable{
				{Uid: "ret", Name: "value", DataType: workflowapi.Int},
			},
		},
		EntryTransition: engine.Transition{TargetID: engine.StateIdle},
		Actions:         map[string]engine.Executable{},
		OutputAssignments: map[string]workflowapi.Expression{
			"ret": {
				Expression: "${}",
				DataType:   workflowapi.Int,
				References: []workflowapi.Reference{{SrcId: engine.SrcFnArg, VarId: "a"}},
			},
		},
	}
}

func TestNewFunctionCall(t *testing.T) {
	t.Run("missing input binding errors", func(t *testing.T) {
		fn := passthroughFn()
		_, err := NewFunctionCall("fc", fn,
			map[string]workflowapi.Expression{}, // no binding for arg "a"
			map[string]workflowapi.OutputBinding{
				"ret": {Active: true, Mode: workflowapi.OutputBindingModeEmit},
			},
			"",
		)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing input binding")
	})

	t.Run("missing output binding errors", func(t *testing.T) {
		fn := passthroughFn()
		_, err := NewFunctionCall("fc", fn,
			map[string]workflowapi.Expression{
				"a": {Expression: "1", DataType: workflowapi.Int},
			},
			map[string]workflowapi.OutputBinding{}, // no binding for return "ret"
			"",
		)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing output binding")
	})

	t.Run("constructs successfully when all bindings provided", func(t *testing.T) {
		fn := passthroughFn()
		_, err := NewFunctionCall("fc", fn,
			map[string]workflowapi.Expression{
				"a": {Expression: "1", DataType: workflowapi.Int},
			},
			map[string]workflowapi.OutputBinding{
				"ret": {Active: true, Mode: workflowapi.OutputBindingModeEmit},
			},
			"",
		)
		require.NoError(t, err)
	})
}

func TestFunctionCall_Outputs(t *testing.T) {
	t.Run("emits returns with emit-mode bindings", func(t *testing.T) {
		fn := &engine.Function{
			Info: workflowapi.FunctionInfo{
				Id:   "fn2",
				Name: "two-returns",
				Returns: []workflowapi.Variable{
					{Uid: "r1", Name: "first", DataType: workflowapi.Int},
					{Uid: "r2", Name: "second", DataType: workflowapi.String},
				},
			},
		}
		fc := &FunctionCall{}
		// Construct manually to control bindings.
		fc, err := NewFunctionCall("fc", fn,
			map[string]workflowapi.Expression{},
			map[string]workflowapi.OutputBinding{
				"r1": {Active: true, Mode: workflowapi.OutputBindingModeEmit},
				"r2": {
					Active: true,
					Mode:   workflowapi.OutputBindingModeAssign,
					Target: &workflowapi.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
				},
			},
			"",
		)
		require.NoError(t, err)

		out := fc.Outputs()
		assert.Contains(t, out, "r1")
		assert.NotContains(t, out, "r2") // assign mode strips from emitter outputs
		assert.Equal(t, workflowapi.Int, out["r1"])
	})
}

func TestFunctionCall_Execute(t *testing.T) {
	t.Run("evaluates input bindings, runs fn, applies output bindings", func(t *testing.T) {
		s, err := engine.NewMainScope([]workflowapi.Variable{
			{Uid: "x", DataType: workflowapi.Int, InitialValue: float64(11)},
			{Uid: "y", DataType: workflowapi.Int}, // assign target
		})
		require.NoError(t, err)

		fn := passthroughFn()
		fc, err := NewFunctionCall("fc", fn,
			map[string]workflowapi.Expression{
				"a": {
					Expression: "${}",
					DataType:   workflowapi.Int,
					References: []workflowapi.Reference{{SrcId: engine.SrcDeclared, VarId: "x"}},
				},
			},
			map[string]workflowapi.OutputBinding{
				"ret": {
					Active: true,
					Mode:   workflowapi.OutputBindingModeAssign,
					Target: &workflowapi.Reference{SrcId: engine.SrcDeclared, VarId: "y"},
				},
			},
			"",
		)
		require.NoError(t, err)

		next, err := fc.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		v, err := s.Resolve(workflowapi.Reference{SrcId: engine.SrcDeclared, VarId: "y"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(11), v)
	})

	t.Run("input expression error is wrapped with node and arg name", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		fn := passthroughFn()
		fc, err := NewFunctionCall("fc-bad", fn,
			map[string]workflowapi.Expression{
				"a": {
					Expression: "${}",
					DataType:   workflowapi.Int,
					References: []workflowapi.Reference{{SrcId: "missing", VarId: "x"}},
				},
			},
			map[string]workflowapi.OutputBinding{
				"ret": {Active: true, Mode: workflowapi.OutputBindingModeEmit},
			},
			"",
		)
		require.NoError(t, err)

		_, err = fc.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "function_call fc-bad")
		assert.Contains(t, err.Error(), "argument a")
	})

	t.Run("argument is cast to declared dataType", func(t *testing.T) {
		// Caller supplies a float; arg is declared Int — must be coerced.
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		fn := passthroughFn()
		fc, err := NewFunctionCall("fc", fn,
			map[string]workflowapi.Expression{
				"a": {Expression: "3.7", DataType: workflowapi.Float},
			},
			map[string]workflowapi.OutputBinding{
				"ret": {
					Active: true,
					Mode:   workflowapi.OutputBindingModeEmit,
				},
			},
			"",
		)
		require.NoError(t, err)

		_, err = fc.Execute(context.Background(), s)
		require.NoError(t, err)

		// Result was cast to int (truncation).
		v, err := s.Resolve(workflowapi.Reference{SrcId: "fc", VarId: "ret"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(3), v)
	})

	t.Run("transitions to wired target", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		fn := passthroughFn()
		fc, err := NewFunctionCall("fc", fn,
			map[string]workflowapi.Expression{"a": {Expression: "1", DataType: workflowapi.Int}},
			map[string]workflowapi.OutputBinding{
				"ret": {Active: true, Mode: workflowapi.OutputBindingModeEmit},
			},
			"",
		)
		require.NoError(t, err)
		require.NoError(t, fc.AddTransition(engine.PortCtrl, engine.Transition{TargetID: "next"}))

		next, err := fc.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, "next", next)
	})

	t.Run("inactive output binding skips the write", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		fn := passthroughFn()
		fc, err := NewFunctionCall("fc", fn,
			map[string]workflowapi.Expression{"a": {Expression: "5", DataType: workflowapi.Int}},
			map[string]workflowapi.OutputBinding{
				"ret": {
					Active: false,
					Mode:   workflowapi.OutputBindingModeEmit,
					Name:   pointer.Ptr("ignored"),
				},
			},
			"",
		)
		require.NoError(t, err)

		_, err = fc.Execute(context.Background(), s)
		require.NoError(t, err)

		// Nothing written to scope under fc:ret.
		_, err = s.Resolve(workflowapi.Reference{SrcId: "fc", VarId: "ret"})
		require.Error(t, err)
	})
}
