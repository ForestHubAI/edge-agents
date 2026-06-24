package engine

import (
	"context"
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
	Scope        *Scope
	Nodes        map[string]Executable
	Triggers     map[string]Trigger
	InitialState string
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
	state := r.InitialState
	for {
		// Nothing to do, waiting for an event. Select on two things — an event arrives, or ctx cancels
		if state == StateIdle {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case ev := <-events:
				// Apply trigger outputs to scope before transitioning.
				// This allows triggers to carry data into the state machine through their emitted event.
				if ev.Apply != nil {
					ev.Apply(r.Scope)
				}
				state = ev.TargetState
			}
			continue // To top of loop with new state
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
