// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"
	"testing"
	"time"

	"github.com/ForestHubAI/edge-agents/go/engine"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// sinkAction is a minimal Executable that reports when it runs, used to observe
// the runner resuming at a Delay's target.
type sinkAction struct {
	engine.LinearNode
	ran chan string
}

func newSink(id string, ran chan string) *sinkAction {
	return &sinkAction{LinearNode: engine.NewLinearNode(id), ran: ran}
}

func (s *sinkAction) Execute(_ context.Context, scope *engine.Scope) (string, error) {
	s.ran <- s.ID()
	return s.Next(engine.PortCtrl, scope)
}

// TestDelay_AsyncResumeThroughRunner drives the whole async path end-to-end:
// the runner arms the Delay (Execute → StateIdle → idle), the Delay's timer
// goroutine emits the resume event, and the runner continues at the target.
func TestDelay_AsyncResumeThroughRunner(t *testing.T) {
	ran := make(chan string, 1)
	d := NewDelay("d", 5*time.Millisecond)
	require.NoError(t, d.AddTransition("", engine.Transition{TargetID: "sink"}))
	sink := newSink("sink", ran)

	scope, err := engine.NewMainScope(nil)
	require.NoError(t, err)
	r := &engine.Runner{
		Scope:           scope,
		Nodes:           map[string]engine.Executable{"d": d, "sink": sink},
		Triggers:        map[string]engine.Trigger{"d": d},
		EntryTransition: engine.Transition{TargetID: "d"}, // enter (arm) the delay at boot
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()

	select {
	case got := <-ran:
		assert.Equal(t, "sink", got)
	case <-time.After(2 * time.Second):
		t.Fatal("delay did not resume at its target")
	}
	cancel()
	<-done
}

func TestDelay(t *testing.T) {
	t.Run("Execute arms and yields StateIdle without blocking", func(t *testing.T) {
		d := NewDelay("d", time.Hour) // long duration: proves Execute doesn't wait for it
		next, err := d.Execute(context.Background(), nil)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)
	})

	t.Run("Wait emits the wired target after arm + duration", func(t *testing.T) {
		d := NewDelay("d", 5*time.Millisecond)
		require.NoError(t, d.AddTransition("", engine.Transition{TargetID: "next"}))
		t.Cleanup(func() { _ = d.Close() })

		_, err := d.Execute(context.Background(), nil) // arm
		require.NoError(t, err)

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		ev, err := d.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)
	})

	t.Run("Wait blocks until armed", func(t *testing.T) {
		d := NewDelay("d", time.Millisecond)
		require.NoError(t, d.AddTransition("", engine.Transition{TargetID: "next"}))
		t.Cleanup(func() { _ = d.Close() })

		// Not armed: Wait must block on ctx, not fire on the (short) duration.
		ctx, cancel := context.WithCancel(context.Background())
		errCh := make(chan error, 1)
		go func() {
			_, err := d.Wait(ctx)
			errCh <- err
		}()
		select {
		case <-errCh:
			t.Fatal("Wait returned before being armed")
		case <-time.After(30 * time.Millisecond):
		}
		cancel()
		require.ErrorIs(t, <-errCh, context.Canceled)
	})

	t.Run("ctx cancel while counting down returns ctx.Err", func(t *testing.T) {
		d := NewDelay("d", time.Hour)
		require.NoError(t, d.AddTransition("", engine.Transition{TargetID: "next"}))
		t.Cleanup(func() { _ = d.Close() })

		_, err := d.Execute(context.Background(), nil) // arm
		require.NoError(t, err)

		ctx, cancel := context.WithCancel(context.Background())
		errCh := make(chan error, 1)
		go func() {
			_, err := d.Wait(ctx)
			errCh <- err
		}()
		time.Sleep(20 * time.Millisecond) // let it enter the countdown
		cancel()
		require.ErrorIs(t, <-errCh, context.Canceled)
	})

	t.Run("second arm while one is pending is dropped", func(t *testing.T) {
		d := NewDelay("d", 5*time.Millisecond)
		require.NoError(t, d.AddTransition("", engine.Transition{TargetID: "next"}))
		t.Cleanup(func() { _ = d.Close() })

		// Two Execute calls before any Wait consumes: buffered-1 keeps exactly one.
		_, err := d.Execute(context.Background(), nil)
		require.NoError(t, err)
		_, err = d.Execute(context.Background(), nil)
		require.NoError(t, err)

		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		// First Wait consumes the single retained arm and fires.
		ev, err := d.Wait(ctx)
		require.NoError(t, err)
		assert.Equal(t, "next", ev.TargetState)

		// No arm remains: the next Wait blocks until ctx cancels.
		ctx2, cancel2 := context.WithCancel(context.Background())
		errCh := make(chan error, 1)
		go func() {
			_, err := d.Wait(ctx2)
			errCh <- err
		}()
		select {
		case <-errCh:
			t.Fatal("second fire occurred — extra arm was not dropped")
		case <-time.After(30 * time.Millisecond):
		}
		cancel2()
		require.ErrorIs(t, <-errCh, context.Canceled)
	})
}
