package node

import (
	"context"
	"testing"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSetVariable_Execute(t *testing.T) {
	t.Run("evaluates literal expression and writes to scope", func(t *testing.T) {
		s, err := engine.NewMainScope([]api.Variable{
			{Uid: "x", DataType: api.Int},
		})
		require.NoError(t, err)

		n := NewSetVariable("set1",
			api.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
			api.Expression{Expression: "42", DataType: api.Int},
		)

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		v, err := s.Resolve(api.Reference{SrcId: engine.SrcDeclared, VarId: "x"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(42), v)
	})

	t.Run("eval error is wrapped with node id", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		n := NewSetVariable("setBad",
			api.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
			api.Expression{
				Expression: "${}",
				DataType:   api.Int,
				References: []api.Reference{{SrcId: "missing", VarId: "y"}},
			},
		)
		_, err = n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "set_variable setBad")
	})

	t.Run("transitions to wired target", func(t *testing.T) {
		s, err := engine.NewMainScope([]api.Variable{
			{Uid: "x", DataType: api.Int},
		})
		require.NoError(t, err)

		n := NewSetVariable("set2",
			api.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
			api.Expression{Expression: "1", DataType: api.Int},
		)
		require.NoError(t, n.AddTransition(engine.PortCtrl, engine.Transition{TargetID: "next"}))

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, "next", next)
	})

	t.Run("expression referencing scope is evaluated", func(t *testing.T) {
		s, err := engine.NewMainScope([]api.Variable{
			{Uid: "src", DataType: api.Int, InitialValue: float64(10)},
			{Uid: "dst", DataType: api.Int},
		})
		require.NoError(t, err)

		n := NewSetVariable("copy",
			api.Reference{SrcId: engine.SrcDeclared, VarId: "dst"},
			api.Expression{
				Expression: "${} + 5",
				DataType:   api.Int,
				References: []api.Reference{{SrcId: engine.SrcDeclared, VarId: "src"}},
			},
		)
		_, err = n.Execute(context.Background(), s)
		require.NoError(t, err)

		v, err := s.Resolve(api.Reference{SrcId: engine.SrcDeclared, VarId: "dst"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(15), v)
	})
}
