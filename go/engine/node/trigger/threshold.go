// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Direction selects which side of a crossing fires the trigger.
type Direction string

const (
	DirRising  Direction = "rising"
	DirFalling Direction = "falling"
	DirBoth    Direction = "both"
)

const crossingOutID = "output"

// OnThreshold fires when a watched numeric variable crosses a threshold.
type OnThreshold struct {
	engine.TriggerNode
	variable  workflowapi.Reference
	threshold float64
	direction Direction
	deadband  float64 // Hysteresis, signal must move past threshold±deadband to flip side.
	binding   *workflowapi.OutputBinding
	updates   <-chan expr.Value
	wasAbove  bool
	seeded    bool
}

func NewOnThreshold(
	id string,
	variable workflowapi.Reference,
	threshold float64,
	direction Direction,
	deadband float64,
	output *workflowapi.OutputBinding,
	scope *engine.Scope,
) *OnThreshold {
	return &OnThreshold{
		TriggerNode: engine.NewTriggerNode(id),
		variable:    variable,
		threshold:   threshold,
		direction:   direction,
		deadband:    deadband,
		binding:     output,
		updates:     scope.Subscribe(variable.SrcId, variable.VarId),
	}
}

// Outputs advertises the triggering-value slot only when an emit-mode binding
// is configured — matches the convention used elsewhere for optional outputs.
func (t *OnThreshold) Outputs() map[string]workflowapi.DataType {
	if t.binding == nil {
		return nil
	}
	return engine.FilterEmitted(
		map[string]workflowapi.DataType{crossingOutID: workflowapi.Float},
		map[string]workflowapi.OutputBinding{crossingOutID: *t.binding},
	)
}

func (t *OnThreshold) Wait(ctx context.Context) (engine.Event, error) {
	for {
		select {
		case <-ctx.Done():
			return engine.Event{}, ctx.Err()
		case v := <-t.updates:
			if !t.analyze(v) {
				continue
			}
			// Create the event and return it
			ev := engine.Event{TargetState: t.Target()}
			if t.binding != nil {
				binding := *t.binding
				id := t.ID()
				ev.Apply = func(s *engine.Scope) {
					_ = engine.ApplyOutput(s, id, crossingOutID, binding, v)
				}
			}
			return ev, nil
		}
	}
}

func (t *OnThreshold) Close() error { return nil }

// analyze folds v into the trigger's side-of-signal state and returns whether
// this crossing matches the configured direction. First event always seeds
// the baseline without firing.
func (t *OnThreshold) analyze(v expr.Value) bool {
	x := v.AsFloat()

	if !t.seeded {
		t.wasAbove = x > t.threshold
		t.seeded = true
		return false
	}

	var nowAbove bool
	if t.wasAbove {
		nowAbove = x > t.threshold-t.deadband
	} else {
		nowAbove = x > t.threshold+t.deadband
	}
	if nowAbove == t.wasAbove {
		return false
	}
	crossedUp := !t.wasAbove && nowAbove
	t.wasAbove = nowAbove

	switch t.direction {
	case DirRising:
		return crossedUp
	case DirFalling:
		return !crossedUp
	default:
		return true
	}
}
