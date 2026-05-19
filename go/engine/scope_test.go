package engine

import (
	"testing"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/llmproxy"

	"github.com/ForestHubAI/fh-core/go/util/pointer"

	"github.com/ForestHubAI/fh-core/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScope_SetResolve(t *testing.T) {
	t.Run("set then resolve", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)

		s.Set("nodeA", "out", expr.IntVal(42))

		v, err := s.Resolve(api.Reference{SrcId: "nodeA", VarId: "out"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(42), v)
	})

	t.Run("resolve unknown reference errors", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)

		_, err = s.Resolve(api.Reference{SrcId: "nope", VarId: "missing"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "unresolved reference")
	})
}

func TestScope_Subscribe(t *testing.T) {
	t.Run("subscriber receives value on Set", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)

		ch := s.Subscribe("nodeA", "out")
		s.Set("nodeA", "out", expr.FloatVal(3.14))

		select {
		case v := <-ch:
			assert.Equal(t, expr.FloatVal(3.14), v)
		default:
			t.Fatal("expected value on subscriber channel")
		}
	})

	t.Run("multiple subscribers each receive", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)

		c1 := s.Subscribe("n", "v")
		c2 := s.Subscribe("n", "v")
		s.Set("n", "v", expr.BoolVal(true))

		assert.Equal(t, expr.BoolVal(true), <-c1)
		assert.Equal(t, expr.BoolVal(true), <-c2)
	})

	t.Run("set without subscribers does not block", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		// Just shouldn't deadlock.
		s.Set("n", "v", expr.IntVal(1))
	})

	t.Run("send drops when subscriber buffer is full", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		ch := s.Subscribe("n", "v")
		// Fill exactly the buffer; one more should be dropped, never block.
		for i := 0; i < SubBufSize; i++ {
			s.Set("n", "v", expr.IntVal(int64(i)))
		}
		// Extra sets must not block even though channel is full.
		s.Set("n", "v", expr.IntVal(999))

		assert.Len(t, ch, SubBufSize)
	})
}

func TestNewMainScope(t *testing.T) {
	t.Run("seeds declared variables", func(t *testing.T) {
		s, err := NewMainScope([]api.Variable{
			{Uid: "x", DataType: api.Int, InitialValue: float64(7)},
			{Uid: "name", DataType: api.String, InitialValue: "alice"},
		})
		require.NoError(t, err)

		v, err := s.Resolve(api.Reference{SrcId: SrcDeclared, VarId: "x"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(7), v)

		v, err = s.Resolve(api.Reference{SrcId: SrcDeclared, VarId: "name"})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal("alice"), v)
	})

	t.Run("nil InitialValue resolves to zero", func(t *testing.T) {
		s, err := NewMainScope([]api.Variable{
			{Uid: "x", DataType: api.Int, InitialValue: nil},
		})
		require.NoError(t, err)

		v, err := s.Resolve(api.Reference{SrcId: SrcDeclared, VarId: "x"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(0), v)
	})

	t.Run("type-mismatched InitialValue returns error", func(t *testing.T) {
		_, err := NewMainScope([]api.Variable{
			{Uid: "x", DataType: api.Int, InitialValue: "not an int"},
		})
		require.Error(t, err)
	})
}

func TestNewFunctionScope(t *testing.T) {
	t.Run("seeds args under SrcFnArg and declared variables", func(t *testing.T) {
		s, err := NewFunctionScope(
			[]api.Variable{{Uid: "local", DataType: api.String, InitialValue: "init"}},
			map[string]expr.Value{"a": expr.IntVal(5)},
		)
		require.NoError(t, err)

		v, err := s.Resolve(api.Reference{SrcId: SrcFnArg, VarId: "a"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(5), v)

		v, err = s.Resolve(api.Reference{SrcId: SrcDeclared, VarId: "local"})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal("init"), v)
	})

	t.Run("declared variable seeding error propagates", func(t *testing.T) {
		_, err := NewFunctionScope(
			[]api.Variable{{Uid: "bad", DataType: api.Int, InitialValue: "nope"}},
			nil,
		)
		require.Error(t, err)
	})
}

func TestApplyOutput(t *testing.T) {
	t.Run("inactive binding writes nothing", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		err = ApplyOutput(s, "node", "slot", api.OutputBinding{Active: false}, expr.IntVal(1))
		require.NoError(t, err)
		_, err = s.Resolve(api.Reference{SrcId: "node", VarId: "slot"})
		assert.Error(t, err) // not present
	})

	t.Run("emit mode writes under nodeID:slotID", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		err = ApplyOutput(s, "node", "slot", api.OutputBinding{
			Active: true, Mode: api.OutputBindingModeEmit,
		}, expr.IntVal(42))
		require.NoError(t, err)

		v, err := s.Resolve(api.Reference{SrcId: "node", VarId: "slot"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(42), v)
	})

	t.Run("assign mode writes to target", func(t *testing.T) {
		s, err := NewMainScope([]api.Variable{
			{Uid: "x", DataType: api.Int},
		})
		require.NoError(t, err)
		err = ApplyOutput(s, "node", "slot", api.OutputBinding{
			Active: true,
			Mode:   api.OutputBindingModeAssign,
			Target: &api.Reference{SrcId: SrcDeclared, VarId: "x"},
		}, expr.IntVal(99))
		require.NoError(t, err)

		v, err := s.Resolve(api.Reference{SrcId: SrcDeclared, VarId: "x"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(99), v)
	})

	t.Run("assign mode without target returns error", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		err = ApplyOutput(s, "node", "slot", api.OutputBinding{
			Active: true,
			Mode:   api.OutputBindingModeAssign,
			Target: nil,
		}, expr.IntVal(1))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no target")
	})
}

func TestApplyDeclaration(t *testing.T) {
	t.Run("emit mode requires uid", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		err = ApplyDeclaration(s, "node", api.OutputDeclaration{
			Name: "out", Mode: api.OutputDeclarationModeEmit, Uid: nil,
		}, expr.IntVal(1))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing uid")
	})

	t.Run("emit writes under nodeID:uid", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		err = ApplyDeclaration(s, "node", api.OutputDeclaration{
			Name: "out", Mode: api.OutputDeclarationModeEmit, Uid: pointer.Ptr("slot-uid"),
		}, expr.IntVal(7))
		require.NoError(t, err)

		v, err := s.Resolve(api.Reference{SrcId: "node", VarId: "slot-uid"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(7), v)
	})

	t.Run("assign without target errors", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		err = ApplyDeclaration(s, "node", api.OutputDeclaration{
			Name: "out", Mode: api.OutputDeclarationModeAssign, Target: nil,
		}, expr.IntVal(1))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing target")
	})

	t.Run("assign writes to target", func(t *testing.T) {
		s, err := NewMainScope([]api.Variable{{Uid: "y", DataType: api.Int}})
		require.NoError(t, err)
		err = ApplyDeclaration(s, "node", api.OutputDeclaration{
			Name:   "out",
			Mode:   api.OutputDeclarationModeAssign,
			Target: &api.Reference{SrcId: SrcDeclared, VarId: "y"},
		}, expr.IntVal(123))
		require.NoError(t, err)

		v, err := s.Resolve(api.Reference{SrcId: SrcDeclared, VarId: "y"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(123), v)
	})

	t.Run("unknown mode errors", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		err = ApplyDeclaration(s, "node", api.OutputDeclaration{
			Name: "out", Mode: "bogus",
		}, expr.IntVal(1))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "unknown mode")
	})
}

// fakeEmitter is a minimal Emitter used to test RegisterNodeOutputs.
type fakeEmitter struct {
	id      string
	outputs map[string]api.DataType
}

func (f *fakeEmitter) ID() string                             { return f.id }
func (f *fakeEmitter) AddTransition(string, Transition) error { return nil }
func (f *fakeEmitter) Outputs() map[string]api.DataType       { return f.outputs }

func TestRegisterNodeOutputs(t *testing.T) {
	s, err := NewMainScope(nil)
	require.NoError(t, err)

	em := &fakeEmitter{
		id: "n1",
		outputs: map[string]api.DataType{
			"a": api.Int,
			"b": api.String,
		},
	}
	RegisterNodeOutputs(s, em)

	v, err := s.Resolve(api.Reference{SrcId: "n1", VarId: "a"})
	require.NoError(t, err)
	assert.Equal(t, expr.IntVal(0), v)

	v, err = s.Resolve(api.Reference{SrcId: "n1", VarId: "b"})
	require.NoError(t, err)
	assert.Equal(t, expr.StringVal(""), v)
}

func TestScope_Conversation(t *testing.T) {
	s, err := NewMainScope(nil)
	require.NoError(t, err)

	assert.Empty(t, s.GetConversation())

	s.SetConversation(llmproxy.InputString("hello"))
	conv := s.GetConversation()
	assert.NotEmpty(t, conv)
}
