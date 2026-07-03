package trigger

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

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
	variable  workflow.Reference
	threshold float64
	direction Direction
	deadband  float64 // Hysteresis, signal must move past threshold±deadband to flip side.
	binding   *workflow.OutputBinding
	updates   <-chan expr.Value
	wasAbove  bool
	seeded    bool
}

func NewOnThreshold(
	id string,
	variable workflow.Reference,
	threshold float64,
	direction Direction,
	deadband float64,
	output *workflow.OutputBinding,
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
func (t *OnThreshold) Outputs() map[string]workflow.DataType {
	if t.binding == nil {
		return nil
	}
	return engine.FilterEmitted(
		map[string]workflow.DataType{crossingOutID: workflow.Float},
		map[string]workflow.OutputBinding{crossingOutID: *t.binding},
	)
}

func (t *OnThreshold) Wait(ctx context.Context) (engine.Event, error) {
	for {
		select {
		case <-ctx.Done():
			return engine.Event{}, ctx.Err()
		case v := <-t.updates:
			fired, err := t.analyze(v)
			if err != nil {
				return engine.Event{}, err
			}
			if !fired {
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
func (t *OnThreshold) analyze(v expr.Value) (bool, error) {
	// A threshold is a numeric crossing; any non-numeric value would coerce to 0
	// and silently mis-fire, so reject it instead of guessing.
	if v.Type != workflow.Int && v.Type != workflow.Float {
		return false, fmt.Errorf("threshold trigger %s: watched value is %s, not numeric", t.ID(), v.Type)
	}
	x := v.AsFloat()

	if !t.seeded {
		t.wasAbove = x > t.threshold
		t.seeded = true
		return false, nil
	}

	var nowAbove bool
	if t.wasAbove {
		nowAbove = x > t.threshold-t.deadband
	} else {
		nowAbove = x > t.threshold+t.deadband
	}
	if nowAbove == t.wasAbove {
		return false, nil
	}
	crossedUp := !t.wasAbove && nowAbove
	t.wasAbove = nowAbove

	switch t.direction {
	case DirRising:
		return crossedUp, nil
	case DirFalling:
		return !crossedUp, nil
	default:
		return true, nil
	}
}
