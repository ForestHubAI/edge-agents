package trigger

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

const serialReceiveOutID = "output"

// OnSerialReceive fires whenever a line is received on the configured UART
// channel, emitting the line (terminator stripped) to its output binding.
type OnSerialReceive struct {
	engine.TriggerNode
	binding  workflow.OutputBinding
	incoming <-chan string
}

// NewOnSerialReceive creates a new OnSerialReceive trigger.
func NewOnSerialReceive(id string, uart *channel.UART, binding workflow.OutputBinding) *OnSerialReceive {
	return &OnSerialReceive{
		TriggerNode: engine.NewTriggerNode(id),
		binding:     binding,
		incoming:    uart.Subscribe(),
	}
}

func (t *OnSerialReceive) Outputs() map[string]workflow.DataType {
	return engine.FilterEmitted(
		map[string]workflow.DataType{serialReceiveOutID: workflow.String},
		map[string]workflow.OutputBinding{serialReceiveOutID: t.binding},
	)
}

func (t *OnSerialReceive) Wait(ctx context.Context) (engine.Event, error) {
	select {
	case <-ctx.Done():
		return engine.Event{}, ctx.Err()
	case line, ok := <-t.incoming:
		if !ok {
			return engine.Event{}, fmt.Errorf("onSerialReceive %s: stream closed", t.ID())
		}
		binding := t.binding
		return engine.Event{
			TargetState: t.Target(),
			Apply: func(s *engine.Scope) {
				_ = engine.ApplyOutput(s, t.ID(), serialReceiveOutID, binding, expr.StringVal(line))
			},
		}, nil
	}
}

func (t *OnSerialReceive) Close() error { return nil }
