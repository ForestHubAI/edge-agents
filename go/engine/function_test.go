package engine

import (
	"context"
	"errors"
	"testing"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/engine/expr"

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
	outputs map[string]api.DataType
}

func (a *fakeAction) ID() string                             { return a.id }
func (a *fakeAction) AddTransition(string, Transition) error { return nil }
func (a *fakeAction) Outputs() map[string]api.DataType       { return a.outputs }
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
				v, err := s.Resolve(api.Reference{SrcId: SrcFnArg, VarId: "a"})
				if err != nil {
					return err
				}
				s.Set(SrcDeclared, "result", expr.IntVal(v.AsInt()*2))
				return nil
			},
		}
		fn := &Function{
			Info: api.FunctionInfo{
				Name: "double",
				Id:   "fn1",
				Arguments: []api.Variable{
					{Uid: "a", DataType: api.Int},
				},
				Returns: []api.Variable{
					{Uid: "ret", Name: "value", DataType: api.Int},
				},
			},
			DeclaredVars: []api.Variable{
				{Uid: "result", DataType: api.Int},
			},
			InitialState: "double",
			Actions:      map[string]Executable{"double": action},
			OutputAssignments: map[string]api.Expression{
				"ret": {
					Expression: "${}",
					DataType:   api.Int,
					References: []api.Reference{{SrcId: SrcDeclared, VarId: "result"}},
				},
			},
		}

		out, err := fn.Call(context.Background(), map[string]expr.Value{"a": expr.IntVal(7)})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(14), out["ret"])
	})

	t.Run("missing output assignment errors", func(t *testing.T) {
		fn := &Function{
			Info: api.FunctionInfo{
				Name:    "f",
				Returns: []api.Variable{{Uid: "ret", Name: "value", DataType: api.Int}},
			},
			InitialState:      StateIdle,
			Actions:           map[string]Executable{},
			OutputAssignments: map[string]api.Expression{}, // missing
		}

		_, err := fn.Call(context.Background(), nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing output assignment")
	})

	t.Run("missing node id during execution errors", func(t *testing.T) {
		fn := &Function{
			Info:              api.FunctionInfo{Name: "f"},
			InitialState:      "ghost",
			Actions:           map[string]Executable{}, // no node "ghost"
			OutputAssignments: map[string]api.Expression{},
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
			Info:              api.FunctionInfo{Name: "f"},
			InitialState:      "boom",
			Actions:           map[string]Executable{"boom": action},
			OutputAssignments: map[string]api.Expression{},
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
			outputs: map[string]api.DataType{"slot": api.Int},
			run: func(s *Scope) error {
				v, err := s.Resolve(api.Reference{SrcId: "emit", VarId: "slot"})
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
			Info:              api.FunctionInfo{Name: "f"},
			InitialState:      "emit",
			Actions:           map[string]Executable{"emit": action},
			OutputAssignments: map[string]api.Expression{},
		}
		_, err := fn.Call(context.Background(), nil)
		require.NoError(t, err)
	})

	t.Run("function scope seeding error propagates", func(t *testing.T) {
		fn := &Function{
			Info: api.FunctionInfo{Name: "bad"},
			DeclaredVars: []api.Variable{
				{Uid: "x", DataType: api.Int, InitialValue: "not int"},
			},
			InitialState: StateIdle,
		}
		_, err := fn.Call(context.Background(), nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "function bad")
	})
}
