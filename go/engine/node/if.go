package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/fh-core/go/api/workflow"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/expr"
)

// Implementation guard
var _ engine.Executable = (*If)(nil)

// If evaluates a boolean condition and advances via the "true" or "false"
// port.
type If struct {
	engine.LinearNode
	condition workflow.Expression
}

// NewIf builds an If node.
func NewIf(id string, condition workflow.Expression) *If {
	return &If{
		LinearNode: engine.NewLinearNode(id),
		condition:  condition,
	}
}

func (n *If) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	result, err := expr.EvalBool(n.condition, scope)
	if err != nil {
		return "", fmt.Errorf("if %s: evaluating condition: %w", n.ID(), err)
	}
	if result {
		return n.Next(engine.PortTrue, scope)
	}
	return n.Next(engine.PortFalse, scope)
}
