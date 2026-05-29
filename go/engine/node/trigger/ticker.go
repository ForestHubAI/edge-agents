package trigger

import (
	"context"
	"time"

	"github.com/ForestHubAI/edge-agents/go/engine"
)

// Ticker fires periodically at a fixed interval.
type Ticker struct {
	engine.TriggerNode
	Interval time.Duration
	tk       *time.Ticker
}

func NewTicker(id string, interval time.Duration) *Ticker {
	return &Ticker{
		TriggerNode: engine.NewTriggerNode(id),
		Interval:    interval,
	}
}

func (t *Ticker) Setup(_ context.Context) error {
	t.tk = time.NewTicker(t.Interval)
	return nil
}

func (t *Ticker) Wait(ctx context.Context) (engine.Event, error) {
	select {
	case <-ctx.Done():
		return engine.Event{}, ctx.Err()
	case <-t.tk.C:
		return engine.Event{TargetState: t.Target()}, nil
	}
}

func (t *Ticker) Close() error {
	if t.tk != nil {
		t.tk.Stop()
	}
	return nil
}
