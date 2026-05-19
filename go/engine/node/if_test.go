package node

import (
	"context"
	"testing"

	"github.com/ForestHubAI/fh-core/go/api/workflow"

	"github.com/ForestHubAI/fh-core/go/engine"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestIf_Execute(t *testing.T) {
	t.Run("true branch fires when condition evaluates true", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		n := NewIf("if1", workflow.Expression{
			Expression: "true",
			DataType:   workflow.Bool,
		})
		require.NoError(t, n.AddTransition(engine.PortTrue, engine.Transition{TargetID: "yes"}))
		require.NoError(t, n.AddTransition(engine.PortFalse, engine.Transition{TargetID: "no"}))

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, "yes", next)
	})

	t.Run("false branch fires when condition evaluates false", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		n := NewIf("if1", workflow.Expression{
			Expression: "false",
			DataType:   workflow.Bool,
		})
		require.NoError(t, n.AddTransition(engine.PortTrue, engine.Transition{TargetID: "yes"}))
		require.NoError(t, n.AddTransition(engine.PortFalse, engine.Transition{TargetID: "no"}))

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, "no", next)
	})

	t.Run("evaluation error is wrapped with node id", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		n := NewIf("ifBad", workflow.Expression{
			Expression: "${}",
			DataType:   workflow.Bool,
			References: []workflow.Reference{{SrcId: "missing", VarId: "x"}},
		})
		_, err = n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "if ifBad")
		assert.Contains(t, err.Error(), "evaluating condition")
	})

	t.Run("returns idle when matching port has no transition", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		n := NewIf("if1", workflow.Expression{
			Expression: "true",
			DataType:   workflow.Bool,
		})
		// Only false port wired; true path falls through to idle.
		require.NoError(t, n.AddTransition(engine.PortFalse, engine.Transition{TargetID: "no"}))

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)
	})

	t.Run("evaluates expression against scope", func(t *testing.T) {
		s, err := engine.NewMainScope([]workflow.Variable{
			{Uid: "x", DataType: workflow.Int, InitialValue: float64(5)},
		})
		require.NoError(t, err)
		n := NewIf("if1", workflow.Expression{
			Expression: "${} > 3",
			DataType:   workflow.Bool,
			References: []workflow.Reference{{SrcId: engine.SrcDeclared, VarId: "x"}},
		})
		require.NoError(t, n.AddTransition(engine.PortTrue, engine.Transition{TargetID: "yes"}))

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, "yes", next)
	})
}
