package trigger

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/channel"
)

// Edge selects which transitions fire the trigger.
type Edge string

const (
	EdgeRising  Edge = "rising"
	EdgeFalling Edge = "falling"
	EdgeBoth    Edge = "both"
)

// OnPinEdge fires when a digital pin sees the configured edge transition.
type OnPinEdge struct {
	engine.TriggerNode
	edge   Edge
	events <-chan bool
}

// NewOnPinEdge subscribes to the channel's edge stream and returns the trigger.
func NewOnPinEdge(id string, gpioin *channel.GPIOInput, edge Edge) *OnPinEdge {
	return &OnPinEdge{
		TriggerNode: engine.NewTriggerNode(id),
		edge:        edge,
		events:      gpioin.Subscribe(),
	}
}

func (p *OnPinEdge) Wait(ctx context.Context) (engine.Event, error) {
	for {
		select {
		case <-ctx.Done():
			return engine.Event{}, ctx.Err()
		case ev, ok := <-p.events:
			if !ok {
				return engine.Event{}, fmt.Errorf("onPinEdge %s: edge stream closed", p.ID())
			}
			if !p.matches(ev) {
				continue
			}
			return engine.Event{TargetState: p.Target()}, nil
		}
	}
}

func (p *OnPinEdge) Close() error { return nil }

// matches reports whether an edge of the given polarity matches the
// trigger's configured filter.
func (p *OnPinEdge) matches(rising bool) bool {
	switch p.edge {
	case EdgeRising:
		return rising
	case EdgeFalling:
		return !rising
	default:
		return true
	}
}
