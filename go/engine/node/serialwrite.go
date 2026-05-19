package node

import (
	"context"
	"fmt"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/channel"
	"github.com/ForestHubAI/fh-core/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*SerialWrite)(nil)

// SerialWrite evaluates a value expression and writes the resulting string
// to a UART channel. No terminator is appended — the caller's expression
// is responsible for any newline / framing.
type SerialWrite struct {
	engine.LinearNode
	value api.Expression
	uart  *channel.UART
}

// NewSerialWrite builds a SerialWrite bound to the given UART channel.
func NewSerialWrite(id string, value api.Expression, uart *channel.UART) *SerialWrite {
	return &SerialWrite{
		LinearNode: engine.NewLinearNode(id),
		value:      value,
		uart:       uart,
	}
}

func (w *SerialWrite) Execute(_ context.Context, scope *engine.Scope) (string, error) {
	s, err := expr.EvalString(w.value, scope)
	if err != nil {
		return "", fmt.Errorf("serialWrite %s: evaluating value: %w", w.ID(), err)
	}
	if err := w.uart.Write(s); err != nil {
		return "", fmt.Errorf("serialWrite %s: %w", w.ID(), err)
	}
	return w.Next(engine.PortCtrl, scope)
}
