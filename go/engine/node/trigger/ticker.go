// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"
	"fmt"
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
	// time.NewTicker panics on a non-positive interval; fail as an error instead.
	if t.Interval <= 0 {
		return fmt.Errorf("ticker %s: interval must be positive, got %s", t.ID(), t.Interval)
	}
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
