// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
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
		case ev := <-p.events:
			if !p.matches(ev) {
				continue
			}
			return p.Emit(nil), nil
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
