// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guard
var _ engine.Executable = (*If)(nil)

// If evaluates a boolean condition and advances via the "true" or "false"
// port.
type If struct {
	engine.LinearNode
	condition workflowapi.Expression
}

// NewIf builds an If node.
func NewIf(id string, condition workflowapi.Expression) *If {
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
