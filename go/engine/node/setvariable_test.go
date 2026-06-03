package node

import (
	"context"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetVariable_Execute(t *testing.T) {
	t.Run("evaluates literal expression and writes to scope", func(t *testing.T) {
		s, err := engine.NewMainScope([]workflow.Variable{
			{Uid: "x", DataType: workflow.Int},
		})
		require.NoError(t, err)

		n := NewSetVariable("set1",
			workflow.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
			workflow.Expression{Expression: "42", DataType: workflow.Int},
		)

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		v, err := s.Resolve(workflow.Reference{SrcId: engine.SrcDeclared, VarId: "x"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(42), v)
	})

	t.Run("eval error is wrapped with node id", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		n := NewSetVariable("setBad",
			workflow.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
			workflow.Expression{
				Expression: "${}",
				DataType:   workflow.Int,
				References: []workflow.Reference{{SrcId: "missing", VarId: "y"}},
			},
		)
		_, err = n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "set_variable setBad")
	})

	t.Run("transitions to wired target", func(t *testing.T) {
		s, err := engine.NewMainScope([]workflow.Variable{
			{Uid: "x", DataType: workflow.Int},
		})
		require.NoError(t, err)

		n := NewSetVariable("set2",
			workflow.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
			workflow.Expression{Expression: "1", DataType: workflow.Int},
		)
		require.NoError(t, n.AddTransition(engine.PortCtrl, engine.Transition{TargetID: "next"}))

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, "next", next)
	})

	t.Run("expression referencing scope is evaluated", func(t *testing.T) {
		s, err := engine.NewMainScope([]workflow.Variable{
			{Uid: "src", DataType: workflow.Int, InitialValue: float64(10)},
			{Uid: "dst", DataType: workflow.Int},
		})
		require.NoError(t, err)

		n := NewSetVariable("copy",
			workflow.Reference{SrcId: engine.SrcDeclared, VarId: "dst"},
			workflow.Expression{
				Expression: "${} + 5",
				DataType:   workflow.Int,
				References: []workflow.Reference{{SrcId: engine.SrcDeclared, VarId: "src"}},
			},
		)
		_, err = n.Execute(context.Background(), s)
		require.NoError(t, err)

		v, err := s.Resolve(workflow.Reference{SrcId: engine.SrcDeclared, VarId: "dst"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(15), v)
	})
}
