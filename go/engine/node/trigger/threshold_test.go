// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"
	"testing"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestThreshold constructs an OnThreshold against a fresh scope and
// returns the trigger plus the scope used to push values.
func newTestThreshold(t *testing.T, threshold float64, dir Direction, deadband float64, binding *workflowapi.OutputBinding) (*OnThreshold, *engine.Scope) {
	t.Helper()
	scope, err := engine.NewMainScope(nil)
	require.NoError(t, err)
	tr := NewOnThreshold(
		"th",
		workflowapi.Reference{SrcId: "src", VarId: "v"},
		threshold,
		dir,
		deadband,
		binding,
		scope,
	)
	return tr, scope
}

// fired runs analyze, asserts it returned no error, and yields whether it fired.
func fired(t *testing.T, tr *OnThreshold, v expr.Value) bool {
	t.Helper()
	f, err := tr.analyze(v)
	require.NoError(t, err)
	return f
}

func TestOnThreshold_Analyze(t *testing.T) {
	t.Run("first observation seeds without firing", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 50, DirBoth, 0, nil)
		assert.False(t, fired(t, tr, expr.FloatVal(60)))
		assert.True(t, tr.seeded)
		assert.True(t, tr.wasAbove)
	})

	t.Run("seeded below threshold", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 50, DirBoth, 0, nil)
		assert.False(t, fired(t, tr, expr.FloatVal(40)))
		assert.False(t, tr.wasAbove)
	})

	t.Run("DirBoth fires on rising and falling crossings", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 50, DirBoth, 0, nil)
		assert.False(t, fired(t, tr, expr.FloatVal(40))) // seed below
		assert.True(t, fired(t, tr, expr.FloatVal(60)))  // rising fires
		assert.True(t, fired(t, tr, expr.FloatVal(40)))  // falling fires
	})

	t.Run("DirRising suppresses falling crossings", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 50, DirRising, 0, nil)
		assert.False(t, fired(t, tr, expr.FloatVal(40))) // seed below
		assert.True(t, fired(t, tr, expr.FloatVal(60)))  // rising fires
		assert.False(t, fired(t, tr, expr.FloatVal(40))) // falling does not
	})

	t.Run("DirFalling suppresses rising crossings", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 50, DirFalling, 0, nil)
		assert.False(t, fired(t, tr, expr.FloatVal(60))) // seed above
		assert.True(t, fired(t, tr, expr.FloatVal(40)))  // falling fires
		assert.False(t, fired(t, tr, expr.FloatVal(60))) // rising does not
	})

	t.Run("no flip if value stays on same side", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 50, DirBoth, 0, nil)
		assert.False(t, fired(t, tr, expr.FloatVal(40))) // seed below
		assert.False(t, fired(t, tr, expr.FloatVal(45))) // still below
		assert.False(t, fired(t, tr, expr.FloatVal(49))) // still below
	})

	t.Run("deadband suppresses noisy crossings", func(t *testing.T) {
		// threshold=50, deadband=2 → must rise above 52 to flip up,
		// then fall below 48 to flip back down.
		tr, _ := newTestThreshold(t, 50, DirBoth, 2, nil)
		assert.False(t, fired(t, tr, expr.FloatVal(40))) // seed below
		assert.False(t, fired(t, tr, expr.FloatVal(51))) // 51 ≤ 52, still below
		assert.True(t, fired(t, tr, expr.FloatVal(53)))  // crosses 52 → fires up
		assert.False(t, fired(t, tr, expr.FloatVal(49))) // 49 ≥ 48, still above
		assert.True(t, fired(t, tr, expr.FloatVal(47)))  // crosses 48 → fires down
	})

	t.Run("non-numeric value is rejected", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 50, DirBoth, 0, nil)
		_, err := tr.analyze(expr.ImageVal([]byte{0x1}))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "not numeric")
	})
}

func TestOnThreshold_Outputs(t *testing.T) {
	t.Run("returns nil when no binding configured", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 0, DirBoth, 0, nil)
		assert.Nil(t, tr.Outputs())
	})

	t.Run("emit binding exposes the output slot", func(t *testing.T) {
		binding := workflowapi.OutputBinding{Active: true, Mode: workflowapi.OutputBindingModeEmit}
		tr, _ := newTestThreshold(t, 0, DirBoth, 0, &binding)
		out := tr.Outputs()
		assert.Equal(t, workflowapi.Float, out["output"])
	})

	t.Run("assign-mode binding produces no emitter outputs", func(t *testing.T) {
		binding := workflowapi.OutputBinding{
			Active: true,
			Mode:   workflowapi.OutputBindingModeAssign,
			Target: &workflowapi.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
		}
		tr, _ := newTestThreshold(t, 0, DirBoth, 0, &binding)
		assert.NotContains(t, tr.Outputs(), "output")
	})
}

func TestOnThreshold_Wait(t *testing.T) {
	t.Run("emits event with Apply that writes triggering value", func(t *testing.T) {
		binding := workflowapi.OutputBinding{Active: true, Mode: workflowapi.OutputBindingModeEmit}
		tr, scope := newTestThreshold(t, 50, DirBoth, 0, &binding)
		require.NoError(t, tr.AddTransition("", engine.Transition{TargetID: "next"}))

		// Seed below threshold.
		scope.Set("src", "v", expr.FloatVal(40))

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()

		// Push a rising value in another goroutine while Wait blocks.
		go func() {
			scope.Set("src", "v", expr.FloatVal(60))
		}()

		ev, err := tr.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)
		require.NotNil(t, ev.Apply)

		// Apply the event onto the scope and verify the slot is populated.
		ev.Apply(scope)
		v, err := scope.Resolve(workflowapi.Reference{SrcId: "th", VarId: "output"})
		require.NoError(t, err)
		assert.Equal(t, expr.FloatVal(60), v)
	})

	t.Run("ctx cancel returns ctx.Err", func(t *testing.T) {
		tr, _ := newTestThreshold(t, 0, DirBoth, 0, nil)
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := tr.Wait(ctx)
		require.ErrorIs(t, err, context.Canceled)
	})

	t.Run("non-firing updates are skipped silently", func(t *testing.T) {
		tr, scope := newTestThreshold(t, 50, DirRising, 0, nil)
		require.NoError(t, tr.AddTransition("", engine.Transition{TargetID: "next"}))
		// Seed
		scope.Set("src", "v", expr.FloatVal(40))

		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()

		// Two non-firing pushes (both below threshold), then a firing one.
		go func() {
			scope.Set("src", "v", expr.FloatVal(45))
			scope.Set("src", "v", expr.FloatVal(48))
			scope.Set("src", "v", expr.FloatVal(60)) // rising → fires
		}()

		ev, err := tr.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)
	})
}
