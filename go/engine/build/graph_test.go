// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"context"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubRetriever satisfies engine.Retriever so the retriever case passes its
// nil-backend guard; the build path never queries it.
type stubRetriever struct{}

func (stubRetriever) QueryRAG(context.Context, engine.RAGQueryParams) ([]engine.RAGQueryResult, error) {
	return nil, nil
}

// retrieverNode builds a workflow Node wrapping a Retriever that references
// memoryRef.
func retrieverNode(t *testing.T, id, memoryRef string) workflowapi.Node {
	t.Helper()
	var r workflowapi.RetrieverNode
	r.Id = id
	r.Arguments.MemoryReference = pointer.Ptr(memoryRef)
	r.Arguments.TopK = pointer.Ptr(1)
	var n workflowapi.Node
	require.NoError(t, n.FromRetrieverNode(r))
	return n
}

func retrieverGraph(t *testing.T, collections map[string]string) *graph {
	t.Helper()
	ms, err := engine.NewMainScope(nil)
	require.NoError(t, err)
	return newGraph(&buildContext{
		ctx:         context.Background(),
		channels:    &channels{},
		collections: collections,
		functions:   map[string]*engine.Function{},
		mainScope:   ms,
		retriever:   stubRetriever{},
	})
}

func TestBuildRetriever_DeclaredCollectionBuilds(t *testing.T) {
	g := retrieverGraph(t, map[string]string{"kb-1": "collection-abc"})

	_, err := g.build([]workflowapi.Node{retrieverNode(t, "r1", "kb-1")}, nil)
	require.NoError(t, err)
	_, ok := g.actions["r1"]
	assert.True(t, ok, "retriever node must be registered as an action")
}

func TestBuildRetriever_UndeclaredCollectionFails(t *testing.T) {
	g := retrieverGraph(t, map[string]string{})

	_, err := g.build([]workflowapi.Node{retrieverNode(t, "r1", "kb-1")}, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "r1")
}
