package trigger

import (
	"context"
	"fmt"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/channel"
	"github.com/ForestHubAI/fh-core/go/engine/expr"
)

const serialReceiveOutID = "output"

// OnSerialReceive fires whenever a line is received on the configured UART
// channel, emitting the line (terminator stripped) to its output binding.
type OnSerialReceive struct {
	engine.TriggerNode
	binding  api.OutputBinding
	incoming <-chan string
}

// NewOnSerialReceive creates a new OnSerialReceive trigger.
func NewOnSerialReceive(id string, uart *channel.UART, binding api.OutputBinding) *OnSerialReceive {
	return &OnSerialReceive{
		TriggerNode: engine.NewTriggerNode(id),
		binding:     binding,
		incoming:    uart.Subscribe(),
	}
}

func (t *OnSerialReceive) Outputs() map[string]api.DataType {
	return engine.FilterEmitted(
		map[string]api.DataType{serialReceiveOutID: api.String},
		map[string]api.OutputBinding{serialReceiveOutID: t.binding},
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
