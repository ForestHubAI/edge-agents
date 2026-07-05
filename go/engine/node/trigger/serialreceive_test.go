// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"
	"testing"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestSerialReceive(id string, binding workflow.OutputBinding, incoming <-chan string) *OnSerialReceive {
	return &OnSerialReceive{
		TriggerNode: engine.NewTriggerNode(id),
		binding:     binding,
		incoming:    incoming,
	}
}

func TestOnSerialReceive_Outputs(t *testing.T) {
	t.Run("emit binding exposes the output slot", func(t *testing.T) {
		tr := newTestSerialReceive("t", workflow.OutputBinding{
			Active: true, Mode: workflow.OutputBindingModeEmit,
		}, nil)
		out := tr.Outputs()
		assert.Equal(t, workflow.String, out["output"])
	})

	t.Run("assign-mode binding produces no emitter outputs", func(t *testing.T) {
		tr := newTestSerialReceive("t", workflow.OutputBinding{
			Active: true,
			Mode:   workflow.OutputBindingModeAssign,
			Target: &workflow.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
		}, nil)
		assert.NotContains(t, tr.Outputs(), "output")
	})
}

func TestOnSerialReceive_Wait(t *testing.T) {
	t.Run("emits event with Apply that writes the line", func(t *testing.T) {
		ch := make(chan string, 1)
		ch <- "hello"
		binding := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}
		tr := newTestSerialReceive("t", binding, ch)
		require.NoError(t, tr.AddTransition("", engine.Transition{TargetID: "next"}))

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		ev, err := tr.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)
		require.NotNil(t, ev.Apply)

		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		ev.Apply(s)

		v, err := s.Resolve(workflow.Reference{SrcId: "t", VarId: "output"})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal("hello"), v)
	})

	t.Run("ctx cancel returns ctx.Err", func(t *testing.T) {
		ch := make(chan string)
		tr := newTestSerialReceive("t", workflow.OutputBinding{}, ch)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := tr.Wait(ctx)
		require.ErrorIs(t, err, context.Canceled)
	})

	t.Run("closed stream errors", func(t *testing.T) {
		ch := make(chan string)
		close(ch)
		tr := newTestSerialReceive("t", workflow.OutputBinding{}, ch)
		_, err := tr.Wait(context.Background())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "stream closed")
	})

	t.Run("Close is a no-op", func(t *testing.T) {
		tr := newTestSerialReceive("t", workflow.OutputBinding{}, nil)
		assert.NoError(t, tr.Close())
	})
}
