// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/ForestHubAI/edge-agents/go/logging"
)

const StateIdle = ""

// defaultEventBufSize bounds the runner's incoming event queue. Triggers
// that overflow it are not lost (they're shed back to the trigger goroutine
// which retries on the next iteration).
const defaultEventBufSize = 64

// Runner is the workflow graph interpreter. One Runner executes one workflow;
// construct via the build/ package. It borrows the driver and transport
// registries (owned and closed by main); on exit it releases only what it
// spawns — the trigger goroutines, via their individual Close.
type Runner struct {
	Scope           *Scope
	Nodes           map[string]Executable
	Triggers        map[string]Trigger
	EntryTransition Transition // EntryTransition is the OnStartup edge's transition.
}

// Run starts all trigger goroutines and the state-runner loop. One iteration
// = one node execution or one event consumed. Runs indefinitely until ctx is
// cancelled by the caller. On exit it joins and closes the trigger goroutines;
// the driver and transport registries it borrowed are closed by their owner
// (main) after Run returns. The single ctx is the only lifecycle handle the
// caller needs.
func (r *Runner) Run(ctx context.Context) error {
	events := make(chan Event, defaultEventBufSize)

	wait := r.spawnTriggers(ctx, events)
	defer wait()

	// State-runner loop: wait for events, execute nodes, transition state.
	// The entry transition's TargetID is the initial state; its side effects
	// (e.g. an AgentTask prompt) apply once before that node runs. A failed
	// Apply drops straight to idle, mirroring node execution errors. The zero
	// value is a no-op targeting StateIdle — the "no startup edge" case.
	state := r.EntryTransition.TargetID
	if err := r.EntryTransition.Apply(r.Scope); err != nil {
		logging.Logger.Error().Err(err).Str("node", state).Msg("applying entry transition")
		state = StateIdle
	}
	for {
		// Nothing to do, waiting for an event. Select on two things — an event arrives, or ctx cancels
		if state == StateIdle {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case ev := <-events:
				// Apply the trigger's outputs and its outgoing edge's side effects
				// (e.g. an AgentTask prompt) to the scope before transitioning. On
				// error, log and stay idle rather than jump to a node with a
				// half-seeded scope — mirroring node execution-error handling.
				if ev.Apply != nil {
					if err := ev.Apply(r.Scope); err != nil {
						logging.Logger.Error().Err(err).Str("node", ev.TargetState).Msg("applying trigger event")
						continue
					}
				}
				state = ev.TargetState
			}
			continue // To top of loop with new state
		}

		// Between node executions, honor cancellation without blocking. The idle
		// select above is unreachable while a chain of nodes is executing — and a
		// graph cycle never idles at all — so this is the only shutdown point on
		// the execution path.
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Execute the node for the current state.
		node, ok := r.Nodes[state]
		if !ok {
			return fmt.Errorf("runner: node %q has no executable", state)
		}
		// Execute node
		next, err := node.Execute(ctx, r.Scope)
		if err != nil {
			// Resilient to execution errors: log and transition to idle, but keep the runner alive for future events.
			logging.Logger.Error().Err(err).Str("node", state).Msg("execution error")
			state = StateIdle
			continue
		}
		state = next
	}
}

// spawnTriggers launches one goroutine per trigger and returns a wait
// function the caller should defer.
//
// Each goroutine drives the lifecycle: Wait until an event (or ctx), emit
// it to events, repeat; on exit Close the trigger's resources. The inner
// send select prevents a shutdown deadlock if the events channel fills
// while the state-runner has already exited.
func (r *Runner) spawnTriggers(ctx context.Context, events chan<- Event) func() {
	var wg sync.WaitGroup
	for _, t := range r.Triggers {
		wg.Add(1)
		go func(t Trigger) {
			defer wg.Done()
			defer func() {
				if err := t.Close(); err != nil {
					logging.Logger.Error().Err(err).Str("trigger", t.ID()).Msg("trigger close failed")
				}
			}()
			for {
				ev, err := t.Wait(ctx)
				if err != nil {
					// Shutdown cancellation is routine. Anything else means this
					// trigger is permanently dead while the workflow keeps running
					// — the log line is the only trace it will ever leave.
					if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
						logging.Logger.Error().Err(err).Str("trigger", t.ID()).
							Msg("trigger stopped; it will emit no further events")
					}
					return
				}
				select {
				case <-ctx.Done():
					return
				case events <- ev:
				}
			}
		}(t)
	}
	return wg.Wait
}
