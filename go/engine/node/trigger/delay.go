// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"
	"time"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

// Delay is an asynchronous "wait, then continue" node — a non-blocking await.
// Control flow reaches it like any executable node, which arms a one-shot timer
// and yields: the runner returns to idle and keeps servicing other events while
// the timer counts down. When it expires the trigger goroutine (Wait) emits an
// Event that resumes the flow at the node's target, applying the outgoing
// transition's side effects then. Delay is therefore both an Executable (armed
// by control flow) and a Trigger (emits the timer event); it is registered in
// both collections at build.
//
// Re-arm policy: one pending arm is remembered; arming again while a delay is
// already pending is dropped.
type Delay struct {
	engine.TriggerNode
	duration time.Duration
	armed    chan struct{} // Execute → Wait handoff, buffered(1): remembers one pending arm
}

func NewDelay(id string, d time.Duration) *Delay {
	return &Delay{
		TriggerNode: engine.NewTriggerNode(id),
		duration:    d,
		armed:       make(chan struct{}, 1),
	}
}

// Execute arms the timer and yields (returns StateIdle) — the continuation is
// delivered later as an event from Wait, so the runner is free to service other
// work meanwhile. A second arm while one is already pending is dropped.
func (d *Delay) Execute(_ context.Context, _ *engine.Scope) (string, error) {
	select {
	case d.armed <- struct{}{}:
	default: // already pending; drop the extra arm
		logging.Logger.Debug().Str("node", d.ID()).Msg("delay already armed; dropping")
	}
	return engine.StateIdle, nil
}

// Wait blocks until Execute arms the delay, waits the configured duration, then
// emits the event that resumes at the node's target. Runs on the trigger
// goroutine; ctx cancellation returns at either wait point.
func (d *Delay) Wait(ctx context.Context) (engine.Event, error) {
	select {
	case <-ctx.Done():
		return engine.Event{}, ctx.Err()
	case <-d.armed:
	}
	timer := time.NewTimer(d.duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return engine.Event{}, ctx.Err()
	case <-timer.C:
		return d.Emit(nil), nil
	}
}

func (d *Delay) Close() error { return nil }
