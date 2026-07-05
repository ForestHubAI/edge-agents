// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*WritePin)(nil)

// WritePin writes a digital or analog value to a linked channel. Build
// picks exactly one of the three pointers; the others stay nil.
//
//   - Digital → gpioout (binary)
//   - Analog (PWM)  → pwm (duty cycle in [0,1])
//   - Analog (DAC)  → dac (millivolts)
type WritePin struct {
	engine.LinearNode
	value workflow.Expression

	gpioout *channel.GPIOOutput
	pwm     *channel.PWM
	dac     *channel.DAC
}

// NewWritePinDigital builds a WritePin bound to a GPIO output channel.
func NewWritePinDigital(id string, value workflow.Expression, gpioout *channel.GPIOOutput) *WritePin {
	return &WritePin{
		LinearNode: engine.NewLinearNode(id),
		value:      value,
		gpioout:    gpioout,
	}
}

// NewWritePinPWM builds a WritePin bound to a PWM output channel.
func NewWritePinPWM(id string, value workflow.Expression, pwm *channel.PWM) *WritePin {
	return &WritePin{
		LinearNode: engine.NewLinearNode(id),
		value:      value,
		pwm:        pwm,
	}
}

// NewWritePinDAC builds a WritePin bound to a DAC output channel.
func NewWritePinDAC(id string, value workflow.Expression, dac *channel.DAC) *WritePin {
	return &WritePin{
		LinearNode: engine.NewLinearNode(id),
		value:      value,
		dac:        dac,
	}
}

// Execute evaluates the value expression and writes it through the linked
// channel. Digital coerces to bool; PWM expects a duty in [0,1]; DAC
// expects millivolts.
func (w *WritePin) Execute(_ context.Context, scope *engine.Scope) (string, error) {
	v, err := expr.Eval(w.value, scope)
	if err != nil {
		return "", fmt.Errorf("writePin %s: evaluating value: %w", w.ID(), err)
	}
	switch {
	case w.gpioout != nil:
		if err := w.gpioout.Write(v.AsBool()); err != nil {
			return "", fmt.Errorf("writePin %s: %w", w.ID(), err)
		}
	case w.pwm != nil:
		if err := w.pwm.Write(v.AsFloat()); err != nil {
			return "", fmt.Errorf("writePin %s: %w", w.ID(), err)
		}
	case w.dac != nil:
		if err := w.dac.Write(v.AsFloat()); err != nil {
			return "", fmt.Errorf("writePin %s: %w", w.ID(), err)
		}
	default:
		return "", fmt.Errorf("writePin %s: no channel bound", w.ID())
	}
	return w.Next(engine.PortCtrl, scope)
}
