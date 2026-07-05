// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stringExpr is a tiny helper for literal-string expressions with no references.
func literalString(s string) workflow.Expression {
	return workflow.Expression{Expression: s, DataType: workflow.String}
}

func TestTransition_Apply(t *testing.T) {
	t.Run("AgentTask replaces conversation with evaluated prompt", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		// Pre-existing conversation should be replaced by AgentTask.
		s.SetConversation(llmproxy.InputString("old"))

		tr := Transition{
			TargetID: "next",
			EdgeType: workflow.AgentTask,
			Prompt:   pointer.Ptr(literalString("hello task")),
		}
		require.NoError(t, tr.Apply(s))

		conv := s.GetConversation()
		require.Len(t, conv, 1)
		assert.Equal(t, "hello task", conv[0].String())
	})

	t.Run("AgentTask without prompt errors", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		tr := Transition{TargetID: "next", EdgeType: workflow.AgentTask, Prompt: nil}
		err = tr.Apply(s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "missing prompt")
	})

	t.Run("AgentDelegate appends prompt to existing conversation", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		s.SetConversation(llmproxy.InputString("first"))

		tr := Transition{
			TargetID: "next",
			EdgeType: workflow.AgentDelegate,
			Prompt:   pointer.Ptr(literalString("second")),
		}
		require.NoError(t, tr.Apply(s))

		conv := s.GetConversation()
		require.Len(t, conv, 2)
		assert.Equal(t, "first", conv[0].String())
		assert.Equal(t, "second", conv[1].String())
	})

	t.Run("AgentDelegate without prompt preserves conversation", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		s.SetConversation(llmproxy.InputString("keep"))

		tr := Transition{TargetID: "next", EdgeType: workflow.AgentDelegate, Prompt: nil}
		require.NoError(t, tr.Apply(s))

		conv := s.GetConversation()
		require.Len(t, conv, 1)
		assert.Equal(t, "keep", conv[0].String())
	})

	t.Run("AgentChoice clears the conversation", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		s.SetConversation(llmproxy.InputString("anything"))

		tr := Transition{TargetID: "next", EdgeType: workflow.AgentChoice}
		require.NoError(t, tr.Apply(s))

		assert.Empty(t, s.GetConversation())
	})

	t.Run("Control edge is a no-op", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		s.SetConversation(llmproxy.InputString("preserved"))

		tr := Transition{TargetID: "next", EdgeType: workflow.Control}
		require.NoError(t, tr.Apply(s))

		conv := s.GetConversation()
		require.Len(t, conv, 1)
		assert.Equal(t, "preserved", conv[0].String())
	})

	t.Run("AgentTask propagates expression evaluation error", func(t *testing.T) {
		s, err := NewMainScope(nil) // no variables declared
		require.NoError(t, err)

		// Expression references a missing variable.
		bad := workflow.Expression{
			Expression: "${}",
			DataType:   workflow.String,
			References: []workflow.Reference{{SrcId: "missing", VarId: "x"}},
		}
		tr := Transition{TargetID: "next", EdgeType: workflow.AgentTask, Prompt: &bad}
		err = tr.Apply(s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "agent task prompt")
	})

	t.Run("AgentDelegate propagates expression evaluation error", func(t *testing.T) {
		s, err := NewMainScope(nil)
		require.NoError(t, err)
		bad := workflow.Expression{
			Expression: "${}",
			DataType:   workflow.String,
			References: []workflow.Reference{{SrcId: "missing", VarId: "x"}},
		}
		tr := Transition{TargetID: "next", EdgeType: workflow.AgentDelegate, Prompt: &bad}
		err = tr.Apply(s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "agent delegate prompt")
	})
}
