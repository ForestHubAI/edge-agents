package engine

import (
	"testing"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/llmproxy"

	"github.com/ForestHubAI/fh-core/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLinearNode_AddTransition(t *testing.T) {
	t.Run("adds transition for a port", func(t *testing.T) {
		n := NewLinearNode("n1")
		err := n.AddTransition(PortCtrl, Transition{TargetID: "next"})
		require.NoError(t, err)
	})

	t.Run("rejects duplicate transition on the same port", func(t *testing.T) {
		n := NewLinearNode("n1")
		require.NoError(t, n.AddTransition(PortCtrl, Transition{TargetID: "next"}))
		err := n.AddTransition(PortCtrl, Transition{TargetID: "other"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "duplicate transition")
	})

	t.Run("allows distinct ports on the same node", func(t *testing.T) {
		n := NewLinearNode("n1")
		require.NoError(t, n.AddTransition(PortTrue, Transition{TargetID: "t-target"}))
		require.NoError(t, n.AddTransition(PortFalse, Transition{TargetID: "f-target"}))
	})
}

func TestLinearNode_Next(t *testing.T) {
	t.Run("returns StateIdle when no transition is wired", func(t *testing.T) {
		n := NewLinearNode("n1")
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		next, err := n.Next(PortCtrl, s)
		require.NoError(t, err)
		assert.Equal(t, StateIdle, next)
	})

	t.Run("returns target id and applies transition", func(t *testing.T) {
		n := NewLinearNode("n1")
		require.NoError(t, n.AddTransition(PortCtrl, Transition{
			TargetID: "next",
			EdgeType: api.AgentChoice, // clears conversation as a side effect
		}))
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		s.SetConversation(llmproxy.InputString("will be cleared"))

		next, err := n.Next(PortCtrl, s)
		require.NoError(t, err)
		assert.Equal(t, "next", next)
		assert.Empty(t, s.GetConversation())
	})

	t.Run("propagates Apply errors", func(t *testing.T) {
		n := NewLinearNode("n1")
		require.NoError(t, n.AddTransition(PortCtrl, Transition{
			TargetID: "next",
			EdgeType: api.AgentTask,
			Prompt:   nil, // AgentTask requires prompt → error
		}))
		s, err := NewMainScope(nil)
		require.NoError(t, err)

		_, err = n.Next(PortCtrl, s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "n1")
		assert.Contains(t, err.Error(), PortCtrl)
	})
}

func TestBranchingNode(t *testing.T) {
	t.Run("AddTransition accumulates multiple targets per port", func(t *testing.T) {
		n := NewBranchingNode("b")
		require.NoError(t, n.AddTransition(PortCtrl, Transition{TargetID: "a"}))
		require.NoError(t, n.AddTransition(PortCtrl, Transition{TargetID: "b"}))

		brs := n.Transitions(PortCtrl)
		require.Len(t, brs, 2)
		assert.Equal(t, "a", brs[0].TargetID)
		assert.Equal(t, "b", brs[1].TargetID)
	})

	t.Run("Transitions on unknown port returns nil", func(t *testing.T) {
		n := NewBranchingNode("b")
		assert.Empty(t, n.Transitions("nope"))
	})

	t.Run("ID returns the configured id", func(t *testing.T) {
		n := NewBranchingNode("xyz")
		assert.Equal(t, "xyz", n.ID())
	})
}

func TestToolNode(t *testing.T) {
	t.Run("AddTransition is rejected", func(t *testing.T) {
		n := NewToolNode("t1")
		err := n.AddTransition(PortCtrl, Transition{TargetID: "x"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "tool nodes cannot accept state transitions")
	})

	t.Run("ID returns the configured id", func(t *testing.T) {
		n := NewToolNode("tool-id")
		assert.Equal(t, "tool-id", n.ID())
	})
}

func TestTriggerNode(t *testing.T) {
	t.Run("AddTransition records target the first time", func(t *testing.T) {
		tn := NewTriggerNode("trig")
		require.NoError(t, tn.AddTransition("", Transition{TargetID: "first"}))
		assert.Equal(t, "first", tn.Target())
	})

	t.Run("AddTransition twice errors", func(t *testing.T) {
		tn := NewTriggerNode("trig")
		require.NoError(t, tn.AddTransition("", Transition{TargetID: "first"}))
		err := tn.AddTransition("", Transition{TargetID: "second"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "already has target")
	})

	t.Run("Target is empty before any transition is wired", func(t *testing.T) {
		tn := NewTriggerNode("trig")
		assert.Empty(t, tn.Target())
	})
}

func TestFilterEmitted(t *testing.T) {
	t.Run("unbound slot defaults to emit and is kept", func(t *testing.T) {
		raw := map[string]api.DataType{"out": api.Int}
		out := FilterEmitted(raw, nil)
		assert.Equal(t, raw, out)
	})

	t.Run("emit-mode binding keeps the slot", func(t *testing.T) {
		raw := map[string]api.DataType{"out": api.Int}
		bindings := map[string]api.OutputBinding{
			"out": {Active: true, Mode: api.OutputBindingModeEmit},
		}
		out := FilterEmitted(raw, bindings)
		assert.Equal(t, raw, out)
	})

	t.Run("assign-mode binding strips the slot", func(t *testing.T) {
		raw := map[string]api.DataType{"out": api.Int, "kept": api.String}
		bindings := map[string]api.OutputBinding{
			"out": {Active: true, Mode: api.OutputBindingModeAssign, Target: &api.Reference{}},
		}
		out := FilterEmitted(raw, bindings)
		assert.NotContains(t, out, "out")
		assert.Contains(t, out, "kept")
	})

	t.Run("inactive emit binding still keeps the slot (mode trumps active)", func(t *testing.T) {
		// FilterEmitted only inspects mode, not active. This documents the contract.
		raw := map[string]api.DataType{"out": api.Int}
		bindings := map[string]api.OutputBinding{
			"out": {Active: false, Mode: api.OutputBindingModeEmit, Name: pointer.Ptr("n")},
		}
		out := FilterEmitted(raw, bindings)
		assert.Contains(t, out, "out")
	})
}
