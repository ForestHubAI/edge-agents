package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*ReadPin)(nil)
var _ engine.Emitter = (*ReadPin)(nil)
var _ engine.ToolProvider = (*ReadPin)(nil)

const pinReadOutID = "output"

// ReadPin reads a digital or analog value from a linked channel. Build
// picks one of the two pointers based on signalType; the other stays nil.
type ReadPin struct {
	engine.LinearNode
	signalType      workflow.SignalType
	binding         workflow.OutputBinding
	gpioin          *channel.GPIOInput
	adc             *channel.ADC
	toolDescription string
}

// NewReadPinDigital builds a ReadPin bound to a GPIO input channel.
func NewReadPinDigital(id string, binding workflow.OutputBinding, toolDescription string, gpioin *channel.GPIOInput) *ReadPin {
	return &ReadPin{
		LinearNode:      engine.NewLinearNode(id),
		signalType:      workflow.Digital,
		binding:         binding,
		gpioin:          gpioin,
		toolDescription: toolDescription,
	}
}

// NewReadPinAnalog builds a ReadPin bound to an ADC channel.
func NewReadPinAnalog(id string, binding workflow.OutputBinding, toolDescription string, adc *channel.ADC) *ReadPin {
	return &ReadPin{
		LinearNode:      engine.NewLinearNode(id),
		signalType:      workflow.Analog,
		binding:         binding,
		adc:             adc,
		toolDescription: toolDescription,
	}
}

func (r *ReadPin) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	val, err := r.readPin(ctx, llmproxy.NoArgs{})
	if err != nil {
		return "", err
	}
	if err := engine.ApplyOutput(scope, r.ID(), pinReadOutID, r.binding, val); err != nil {
		return "", fmt.Errorf("readPin %s: applying output: %w", r.ID(), err)
	}
	return r.Next(engine.PortCtrl, scope)
}

func (r *ReadPin) Outputs() map[string]workflow.DataType {
	dt := workflow.Bool
	if r.signalType == workflow.Analog {
		dt = workflow.Float
	}
	return engine.FilterEmitted(
		map[string]workflow.DataType{pinReadOutID: dt},
		map[string]workflow.OutputBinding{pinReadOutID: r.binding},
	)
}

func (r *ReadPin) Tools() ([]llmproxy.FunctionTool, error) {
	ft, err := llmproxy.NewFunctionTool(
		"read_pin",
		r.toolDescription,
		r.readPin,
	)
	if err != nil {
		return nil, fmt.Errorf("readPin %s: %w", r.ID(), err)
	}
	return []llmproxy.FunctionTool{ft}, nil
}

// readPin is the actual implementation of the tool call, unwrapped from the node execution signature
func (r *ReadPin) readPin(_ context.Context, _ llmproxy.NoArgs) (expr.Value, error) {
	switch r.signalType {
	case workflow.Digital:
		v, err := r.gpioin.Read()
		if err != nil {
			return expr.Value{}, fmt.Errorf("readPin %s: %w", r.ID(), err)
		}
		return expr.BoolVal(v), nil
	case workflow.Analog:
		v, err := r.adc.Read()
		if err != nil {
			return expr.Value{}, fmt.Errorf("readPin %s: %w", r.ID(), err)
		}
		return expr.FloatVal(v), nil
	default:
		return expr.Value{}, fmt.Errorf("readPin %s: unknown signalType %q", r.ID(), r.signalType)
	}
}
