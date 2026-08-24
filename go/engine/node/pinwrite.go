// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/schemautil"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*WritePin)(nil)
var _ engine.ToolProvider = (*WritePin)(nil)

// WritePin writes a digital or analog value to a linked channel. Build
// picks exactly one of the three pointers; the others stay nil.
//
//   - Digital → gpioout (binary)
//   - Analog (PWM)  → pwm (duty cycle in [0,1])
//   - Analog (DAC)  → dac (millivolts)
//
// value is nil when the node is wired as a tool: the model supplies the value
// per call instead of the workflow author supplying an expression. The two are
// mutually exclusive — the builder rejects a node that is both tool-wired and
// targeted by control flow.
type WritePin struct {
	engine.LinearNode
	value           *workflowapi.Expression
	toolDescription string
	gpioout         *channel.GPIOOutput
	pwm             *channel.PWM
	dac             *channel.DAC
}

// NewWritePinDigital builds a WritePin bound to a GPIO output channel.
func NewWritePinDigital(id string, value *workflowapi.Expression, toolDescription string, gpioout *channel.GPIOOutput) *WritePin {
	return &WritePin{
		LinearNode:      engine.NewLinearNode(id),
		value:           value,
		toolDescription: toolDescription,
		gpioout:         gpioout,
	}
}

// NewWritePinPWM builds a WritePin bound to a PWM output channel.
func NewWritePinPWM(id string, value *workflowapi.Expression, toolDescription string, pwm *channel.PWM) *WritePin {
	return &WritePin{
		LinearNode:      engine.NewLinearNode(id),
		value:           value,
		toolDescription: toolDescription,
		pwm:             pwm,
	}
}

// NewWritePinDAC builds a WritePin bound to a DAC output channel.
func NewWritePinDAC(id string, value *workflowapi.Expression, toolDescription string, dac *channel.DAC) *WritePin {
	return &WritePin{
		LinearNode:      engine.NewLinearNode(id),
		value:           value,
		toolDescription: toolDescription,
		dac:             dac,
	}
}

// writePinArgs is the tool-call payload. Value is `any` because the JSON type
// the channel accepts is only known per instance — Tools() constrains it in the
// schema and writePin coerces it.
type writePinArgs struct {
	Value any `json:"value"`
}

// Execute evaluates the value expression and writes it through the linked
// channel. The cast to the channel's type happens here so the author-supplied
// expression keeps its lenient conversion; writePin's Coerce is then a no-op.
func (w *WritePin) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	if w.value == nil {
		return "", fmt.Errorf("writePin %s: no value expression", w.ID())
	}
	v, err := expr.Eval(*w.value, scope)
	if err != nil {
		return "", fmt.Errorf("writePin %s: evaluating value: %w", w.ID(), err)
	}
	if _, err := w.writePin(ctx, writePinArgs{Value: v.Cast(w.valueDataType()).Raw}); err != nil {
		return "", err
	}
	return w.Next(engine.PortCtrl, scope)
}

// Tools exposes this node as `write_pin(value)`. The value's JSON type follows
// the bound channel — boolean for GPIO, number for PWM/DAC — so the model is
// constrained to what the hardware accepts. Physical meaning (duty cycle vs
// millivolts, and the safe range) belongs in the node's tool description.
//
// Built by hand rather than through llmproxy.NewFunctionTool: the value's type
// isn't known until the channel is bound, so the schema can't come from a Go type.
func (w *WritePin) Tools() ([]llmproxy.FunctionTool, error) {
	valueSchema, err := w.valueSchema()
	if err != nil {
		return nil, fmt.Errorf("writePin %s: %w", w.ID(), err)
	}
	ft := llmproxy.FunctionTool{
		ExternalToolBase: llmproxy.ExternalToolBase{
			Name:        "write_pin",
			Description: w.toolDescription,
			Parameters:  schemautil.StrictObject(map[string]any{"value": valueSchema}),
		},
		ToolCall: func(ctx context.Context, raw json.RawMessage) (any, error) {
			var args writePinArgs
			if err := json.Unmarshal(raw, &args); err != nil {
				return nil, fmt.Errorf("writePin %s: parse args: %w", w.ID(), err)
			}
			return w.writePin(ctx, args)
		},
	}
	return []llmproxy.FunctionTool{ft}, nil
}

// writePin is the actual implementation of the tool call, unwrapped from the
// node execution signature. Digital coerces to bool; PWM expects a duty in
// [0,1]; DAC expects millivolts.
func (w *WritePin) writePin(_ context.Context, args writePinArgs) (any, error) {
	v, err := expr.Coerce(w.valueDataType(), args.Value)
	if err != nil {
		return nil, fmt.Errorf("writePin %s: value: %w", w.ID(), err)
	}
	switch {
	case w.gpioout != nil:
		if err := w.gpioout.Write(v.AsBool()); err != nil {
			return nil, fmt.Errorf("writePin %s: %w", w.ID(), err)
		}
	case w.pwm != nil:
		if err := w.pwm.Write(v.AsFloat()); err != nil {
			return nil, fmt.Errorf("writePin %s: %w", w.ID(), err)
		}
	case w.dac != nil:
		if err := w.dac.Write(v.AsFloat()); err != nil {
			return nil, fmt.Errorf("writePin %s: %w", w.ID(), err)
		}
	default:
		return nil, fmt.Errorf("writePin %s: no channel bound", w.ID())
	}
	return "ok", nil
}

// valueDataType is the workflow data type the bound channel accepts.
func (w *WritePin) valueDataType() workflowapi.DataType {
	if w.gpioout != nil {
		return workflowapi.Bool
	}
	return workflowapi.Float
}

// valueSchema renders the JSON schema for the tool's single value parameter.
// PWM carries its [0,1] bound in the schema; the others are unbounded here.
func (w *WritePin) valueSchema() (map[string]any, error) {
	switch {
	case w.gpioout != nil:
		return map[string]any{"type": "boolean"}, nil
	case w.pwm != nil:
		return map[string]any{"type": "number", "minimum": 0, "maximum": 1}, nil
	case w.dac != nil:
		return map[string]any{"type": "number"}, nil
	default:
		return nil, fmt.Errorf("no channel bound")
	}
}
