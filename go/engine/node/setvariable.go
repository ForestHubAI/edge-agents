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
var _ engine.Executable = (*SetVariable)(nil)

// SetVariable evaluates an expression and assigns the result to a
// declared variable in the main scope.
type SetVariable struct {
	engine.LinearNode
	variable workflowapi.Reference
	value    workflowapi.Expression
}

// NewSetVariable builds a SetVariable node.
func NewSetVariable(id string, variable workflowapi.Reference, value workflowapi.Expression) *SetVariable {
	return &SetVariable{
		LinearNode: engine.NewLinearNode(id),
		variable:   variable,
		value:      value,
	}
}

func (n *SetVariable) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	val, err := expr.Eval(n.value, scope)
	if err != nil {
		return "", fmt.Errorf("set_variable %s: evaluating value: %w", n.ID(), err)
	}
	scope.Set(n.variable.SrcId, n.variable.VarId, val)
	return n.Next(engine.PortCtrl, scope)
}
