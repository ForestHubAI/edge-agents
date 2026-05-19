package node

import (
	"context"
	"testing"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/util/pointer"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// passthroughFn returns a Function with one Int arg "a" and one Int return "ret"
// where ret = a (passthrough). InitialState is idle so Function.Call evaluates
// only the OutputAssignments — no actions required.
func passthroughFn() *engine.Function {
	return &engine.Function{
		Info: api.FunctionInfo{
			Id:   "fn1",
			Name: "passthrough",
			Arguments: []api.Variable{
				{Uid: "a", Name: "a", DataType: api.Int},
			},
			Returns: []api.Variable{
				{Uid: "ret", Name: "value", DataType: api.Int},
			},
		},
		InitialState: engine.StateIdle,
		Actions:      map[string]engine.Executable{},
		OutputAssignments: map[string]api.Expression{
			"ret": {
				Expression: "${}",
				DataType:   api.Int,
				References: []api.Reference{{SrcId: engine.SrcFnArg, VarId: "a"}},
			},
		},
	}
}

func TestNewFunctionCall(t *testing.T) {
	t.Run("missing input binding errors", func(t *testing.T) {
		fn := passthroughFn()
		_, err := NewFunctionCall("fc", fn,
			map[string]api.Expression{}, // no binding for arg "a"
			map[string]api.OutputBinding{
				"ret": {Active: true, Mode: api.OutputBindingModeEmit},
			},
			"",
		)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing input binding")
	})

	t.Run("missing output binding errors", func(t *testing.T) {
		fn := passthroughFn()
		_, err := NewFunctionCall("fc", fn,
			map[string]api.Expression{
				"a": {Expression: "1", DataType: api.Int},
			},
			map[string]api.OutputBinding{}, // no binding for return "ret"
			"",
		)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing output binding")
	})

	t.Run("constructs successfully when all bindings provided", func(t *testing.T) {
		fn := passthroughFn()
		_, err := NewFunctionCall("fc", fn,
			map[string]api.Expression{
				"a": {Expression: "1", DataType: api.Int},
			},
			map[string]api.OutputBinding{
				"ret": {Active: true, Mode: api.OutputBindingModeEmit},
			},
			"",
		)
		require.NoError(t, err)
	})
}

func TestFunctionCall_Outputs(t *testing.T) {
	t.Run("emits returns with emit-mode bindings", func(t *testing.T) {
		fn := &engine.Function{
			Info: api.FunctionInfo{
				Id:   "fn2",
				Name: "two-returns",
				Returns: []api.Variable{
					{Uid: "r1", Name: "first", DataType: api.Int},
					{Uid: "r2", Name: "second", DataType: api.String},
				},
			},
		}
		fc := &FunctionCall{}
		// Construct manually to control bindings.
		fc, err := NewFunctionCall("fc", fn,
			map[string]api.Expression{},
			map[string]api.OutputBinding{
				"r1": {Active: true, Mode: api.OutputBindingModeEmit},
				"r2": {
					Active: true,
					Mode:   api.OutputBindingModeAssign,
					Target: &api.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
				},
			},
			"",
		)
		require.NoError(t, err)

		out := fc.Outputs()
		assert.Contains(t, out, "r1")
		assert.NotContains(t, out, "r2") // assign mode strips from emitter outputs
		assert.Equal(t, api.Int, out["r1"])
	})
}

func TestFunctionCall_Execute(t *testing.T) {
	t.Run("evaluates input bindings, runs fn, applies output bindings", func(t *testing.T) {
		s, err := engine.NewMainScope([]api.Variable{
			{Uid: "x", DataType: api.Int, InitialValue: float64(11)},
			{Uid: "y", DataType: api.Int}, // assign target
		})
		require.NoError(t, err)

		fn := passthroughFn()
		fc, err := NewFunctionCall("fc", fn,
			map[string]api.Expression{
				"a": {
					Expression: "${}",
					DataType:   api.Int,
					References: []api.Reference{{SrcId: engine.SrcDeclared, VarId: "x"}},
				},
			},
			map[string]api.OutputBinding{
				"ret": {
					Active: true,
					Mode:   api.OutputBindingModeAssign,
					Target: &api.Reference{SrcId: engine.SrcDeclared, VarId: "y"},
				},
			},
			"",
		)
		require.NoError(t, err)

		next, err := fc.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		v, err := s.Resolve(api.Reference{SrcId: engine.SrcDeclared, VarId: "y"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(11), v)
	})

	t.Run("input expression error is wrapped with node and arg name", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		fn := passthroughFn()
		fc, err := NewFunctionCall("fc-bad", fn,
			map[string]api.Expression{
				"a": {
					Expression: "${}",
					DataType:   api.Int,
					References: []api.Reference{{SrcId: "missing", VarId: "x"}},
				},
			},
			map[string]api.OutputBinding{
				"ret": {Active: true, Mode: api.OutputBindingModeEmit},
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
			map[string]api.Expression{
				"a": {Expression: "3.7", DataType: api.Float},
			},
			map[string]api.OutputBinding{
				"ret": {
					Active: true,
					Mode:   api.OutputBindingModeEmit,
				},
			},
			"",
		)
		require.NoError(t, err)

		_, err = fc.Execute(context.Background(), s)
		require.NoError(t, err)

		// Result was cast to int (truncation).
		v, err := s.Resolve(api.Reference{SrcId: "fc", VarId: "ret"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(3), v)
	})

	t.Run("transitions to wired target", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		fn := passthroughFn()
		fc, err := NewFunctionCall("fc", fn,
			map[string]api.Expression{"a": {Expression: "1", DataType: api.Int}},
			map[string]api.OutputBinding{
				"ret": {Active: true, Mode: api.OutputBindingModeEmit},
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
			map[string]api.Expression{"a": {Expression: "5", DataType: api.Int}},
			map[string]api.OutputBinding{
				"ret": {
					Active: false,
					Mode:   api.OutputBindingModeEmit,
					Name:   pointer.Ptr("ignored"),
				},
			},
			"",
		)
		require.NoError(t, err)

		_, err = fc.Execute(context.Background(), s)
		require.NoError(t, err)

		// Nothing written to scope under fc:ret.
		_, err = s.Resolve(api.Reference{SrcId: "fc", VarId: "ret"})
		require.Error(t, err)
	})
}
