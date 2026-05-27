package engine

import (
	"context"
	"errors"
	"sync"

	"github.com/ForestHubAI/fh-core/go/api/workflow"
	"github.com/ForestHubAI/fh-core/go/logging"
)

// BuildFunc builds a Runner from a workflow + the resolved network manifest.
// Injected at Engine construction to avoid import cycle
type BuildFunc func(ctx context.Context, wf *workflow.Workflow, nm *NetworkManifest) (*Runner, error)

// Engine is the long-lived host for one workflow Runner. It owns runner
// lifecycle (start/stop/swap on /deploy and /stop) and the HTTP surface that
// drives that lifecycle.
type Engine struct {
	Secret  string    // shared with backend; used as Authorization bearer for /deploy + /stop
	Builder BuildFunc // constructs a Runner in /deploy from a workflow + network manifest
	// Internal fields
	mu     sync.Mutex         // protect internal fields from concurrent access by HTTP handlers
	runner *Runner            // currently deployed workflow, or nil if idle.
	cancel context.CancelFunc // cancels the runner's context to stop it.
	done   chan struct{}      // closed when Run returns.
}

// Deploy stops any running workflow and starts the new one.
func (e *Engine) Deploy(wf *workflow.Workflow, nm *NetworkManifest) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	// Build new runner BEFORE tearing down the old — if Build fails the old
	// runner keeps serving instead of leaving the engine idle from a config
	// bug. Builder is responsible for closing any partially-allocated
	// resources on failure.
	ctx, cancel := context.WithCancel(context.Background())
	r, err := e.Builder(ctx, wf, nm)
	if err != nil {
		cancel()
		return err
	}

	// Tear down the old runner if it exists
	if e.runner != nil {
		e.cancel()
		<-e.done // Run's defers have released the old runner's resources
	}
	e.runner = r
	e.cancel = cancel
	e.done = make(chan struct{})

	go func() {
		defer close(e.done)
		if err := r.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logging.Logger.Error().Err(err).Msg("runner exited with error")
		}
	}()

	return nil
}

// Stop tears down the currently running workflow and releases its
// transports. Safe to call when idle.
func (e *Engine) Stop() {
	e.mu.Lock()
	defer e.mu.Unlock()

	if e.runner != nil {
		e.cancel()
		<-e.done // Run's defers have released the runner's resources
		e.runner = nil
		e.cancel = nil
	}
}

// IsRunning reports whether a workflow is currently running.
func (e *Engine) IsRunning() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.runner != nil
}
