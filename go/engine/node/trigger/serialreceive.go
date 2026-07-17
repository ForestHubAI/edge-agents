// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

const serialReceiveOutID = "output"

// OnSerialReceive fires whenever a line is received on the configured UART
// channel, emitting the line (terminator stripped) to its output binding.
type OnSerialReceive struct {
	engine.TriggerNode
	binding  workflowapi.OutputBinding
	incoming <-chan string
}

// NewOnSerialReceive creates a new OnSerialReceive trigger.
func NewOnSerialReceive(id string, uart *channel.UART, binding workflowapi.OutputBinding) *OnSerialReceive {
	return &OnSerialReceive{
		TriggerNode: engine.NewTriggerNode(id),
		binding:     binding,
		incoming:    uart.Subscribe(),
	}
}

func (t *OnSerialReceive) Outputs() map[string]workflowapi.DataType {
	return engine.FilterEmitted(
		map[string]workflowapi.DataType{serialReceiveOutID: workflowapi.String},
		map[string]workflowapi.OutputBinding{serialReceiveOutID: t.binding},
	)
}

func (t *OnSerialReceive) Wait(ctx context.Context) (engine.Event, error) {
	select {
	case <-ctx.Done():
		return engine.Event{}, ctx.Err()
	case line := <-t.incoming:
		binding := t.binding
		return t.Emit(func(s *engine.Scope) error {
			return engine.ApplyOutput(s, t.ID(), serialReceiveOutID, binding, expr.StringVal(line))
		}), nil
	}
}

func (t *OnSerialReceive) Close() error { return nil }
