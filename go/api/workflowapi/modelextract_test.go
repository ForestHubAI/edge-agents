// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package workflowapi

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func agentNode(t *testing.T, id, model string) Node {
	t.Helper()
	var a AgentNode
	a.Id = id
	a.Arguments.Model = pointer.Ptr(model)
	var n Node
	require.NoError(t, n.FromAgentNode(a))
	return n
}

func TestReferencedModelIDs_ScansAgentsAndFunctionsDeduped(t *testing.T) {
	wf := &Workflow{
		Nodes: []Node{agentNode(t, "a1", "gpt-4o"), agentNode(t, "a2", "gpt-4o")},
		Functions: []Function{
			{Nodes: []Node{agentNode(t, "f1", "claude")}},
		},
	}
	ids, err := ReferencedModelIDs(wf)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"gpt-4o", "claude"}, ids)
}

func TestReferencedModelIDs_IgnoresNonAgentAndMissingModel(t *testing.T) {
	var noModel AgentNode
	noModel.Id = "a-empty" // Model left nil
	var n Node
	require.NoError(t, n.FromAgentNode(noModel))

	wf := &Workflow{Nodes: []Node{n}}
	ids, err := ReferencedModelIDs(wf)
	require.NoError(t, err)
	assert.Empty(t, ids)
}
