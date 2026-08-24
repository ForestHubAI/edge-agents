// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*SerialWrite)(nil)
var _ engine.ToolProvider = (*SerialWrite)(nil)

// SerialWrite evaluates a value expression and writes the resulting string
// to a text channel — a UART (raw serial bytes) or a Log (a logger line).
// No terminator is appended — the caller's expression is responsible for any
// newline / framing.
//
// value is nil when the node is wired as a tool: the model supplies the text
// per call instead of the workflow author supplying an expression.
type SerialWrite struct {
	engine.LinearNode
	value           *workflowapi.Expression
	toolDescription string
	dst             channel.TextWriter
}

// NewSerialWrite builds a SerialWrite bound to the given text channel.
func NewSerialWrite(id string, value *workflowapi.Expression, toolDescription string, dst channel.TextWriter) *SerialWrite {
	return &SerialWrite{
		LinearNode:      engine.NewLinearNode(id),
		value:           value,
		toolDescription: toolDescription,
		dst:             dst,
	}
}

// serialWriteArgs is the tool-call payload. A text channel always takes a
// string, so the schema is derivable from this type.
type serialWriteArgs struct {
	Value string `json:"value"`
}

func (w *SerialWrite) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	if w.value == nil {
		return "", fmt.Errorf("serialWrite %s: no value expression", w.ID())
	}
	s, err := expr.EvalString(*w.value, scope)
	if err != nil {
		return "", fmt.Errorf("serialWrite %s: evaluating value: %w", w.ID(), err)
	}
	if _, err := w.serialWrite(ctx, serialWriteArgs{Value: s}); err != nil {
		return "", err
	}
	return w.Next(engine.PortCtrl, scope)
}

// Tools exposes this node as `serial_write(value)`.
func (w *SerialWrite) Tools() ([]llmproxy.FunctionTool, error) {
	ft, err := llmproxy.NewFunctionTool("serial_write", w.toolDescription, w.serialWrite)
	if err != nil {
		return nil, fmt.Errorf("serialWrite %s: %w", w.ID(), err)
	}
	return []llmproxy.FunctionTool{ft}, nil
}

// serialWrite is the actual implementation of the tool call, unwrapped from the
// node execution signature.
func (w *SerialWrite) serialWrite(_ context.Context, args serialWriteArgs) (any, error) {
	if err := w.dst.Write(args.Value); err != nil {
		return nil, fmt.Errorf("serialWrite %s: %w", w.ID(), err)
	}
	return "ok", nil
}
