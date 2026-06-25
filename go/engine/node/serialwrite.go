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
var _ engine.Executable = (*SerialWrite)(nil)

// SerialWrite evaluates a value expression and writes the resulting string
// to a text channel — a UART (raw serial bytes) or a Log (a logger line).
// No terminator is appended — the caller's expression is responsible for any
// newline / framing.
type SerialWrite struct {
	engine.LinearNode
	value workflow.Expression
	dst   channel.TextWriter
}

// NewSerialWrite builds a SerialWrite bound to the given text channel.
func NewSerialWrite(id string, value workflow.Expression, dst channel.TextWriter) *SerialWrite {
	return &SerialWrite{
		LinearNode: engine.NewLinearNode(id),
		value:      value,
		dst:        dst,
	}
}

func (w *SerialWrite) Execute(_ context.Context, scope *engine.Scope) (string, error) {
	s, err := expr.EvalString(w.value, scope)
	if err != nil {
		return "", fmt.Errorf("serialWrite %s: evaluating value: %w", w.ID(), err)
	}
	if err := w.dst.Write(s); err != nil {
		return "", fmt.Errorf("serialWrite %s: %w", w.ID(), err)
	}
	return w.Next(engine.PortCtrl, scope)
}
