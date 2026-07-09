// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*SerialRead)(nil)
var _ engine.Emitter = (*SerialRead)(nil)

const serialReadOutID = "output"

// SerialRead blocks on a serial port until one line arrives, then emits it
// through the output binding and advances. The receive buffer is flushed
// first so pre-existing chatter doesn't satisfy the read; when prompt is
// non-empty it is written next, then the blocking read runs.
// The driver's Read steals from the broadcast path while it is in flight,
// so any concurrent OnSerialReceive trigger pauses for the duration.
type SerialRead struct {
	engine.LinearNode
	binding workflowapi.OutputBinding
	prompt  string
	uart    *channel.UART
}

// NewSerialRead builds a SerialRead bound to the given UART channel.
// prompt may be empty.
func NewSerialRead(id string, binding workflowapi.OutputBinding, prompt string, uart *channel.UART) *SerialRead {
	return &SerialRead{
		LinearNode: engine.NewLinearNode(id),
		binding:    binding,
		prompt:     prompt,
		uart:       uart,
	}
}

func (r *SerialRead) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	if err := r.uart.Flush(); err != nil {
		return "", fmt.Errorf("serialRead %s: flushing input: %w", r.ID(), err)
	}
	if r.prompt != "" {
		if err := r.uart.Write(r.prompt); err != nil {
			return "", fmt.Errorf("serialRead %s: writing prompt: %w", r.ID(), err)
		}
	}
	line, err := r.uart.Read(ctx)
	if err != nil {
		return "", fmt.Errorf("serialRead %s: %w", r.ID(), err)
	}
	if err := engine.ApplyOutput(scope, r.ID(), serialReadOutID, r.binding, expr.StringVal(line)); err != nil {
		return "", fmt.Errorf("serialRead %s: applying output: %w", r.ID(), err)
	}
	return r.Next(engine.PortCtrl, scope)
}

// Outputs declares the single "output" slot — a string line. Returns it only
// if the binding is emit-mode (assign/discard don't materialize a variable).
func (r *SerialRead) Outputs() map[string]workflowapi.DataType {
	return engine.FilterEmitted(
		map[string]workflowapi.DataType{serialReadOutID: workflowapi.String},
		map[string]workflowapi.OutputBinding{serialReadOutID: r.binding},
	)
}
