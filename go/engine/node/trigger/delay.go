package trigger

import (
	"context"
	"time"

	"github.com/ForestHubAI/edge-agents/go/engine"
)

// Delay fires exactly once after its configured duration, measured from
// Setup. Subsequent Wait calls block on ctx indefinitely — the single-shot
// semantics mirror the codegen pattern (Ticker::OneShot at startup).
type Delay struct {
	engine.TriggerNode
	Duration time.Duration
	timer    *time.Timer
	fired    bool // state-runner goroutine only; no concurrent access
}

func NewDelay(id string, d time.Duration) *Delay {
	return &Delay{
		TriggerNode: engine.NewTriggerNode(id),
		Duration:    d,
	}
}

func (d *Delay) Setup(_ context.Context) error {
	d.timer = time.NewTimer(d.Duration)
	return nil
}

func (d *Delay) Wait(ctx context.Context) (engine.Event, error) {
	if d.fired {
		<-ctx.Done()
		return engine.Event{}, ctx.Err()
	}
	select {
	case <-ctx.Done():
		return engine.Event{}, ctx.Err()
	case <-d.timer.C:
		d.fired = true
		return engine.Event{TargetState: d.Target()}, nil
	}
}

func (d *Delay) Close() error {
	if d.timer != nil {
		d.timer.Stop()
	}
	return nil
}
