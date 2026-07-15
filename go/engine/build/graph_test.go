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

	err := g.build([]workflowapi.Node{retrieverNode(t, "r1", "kb-1")}, nil)
	require.NoError(t, err)
	_, ok := g.executables["r1"]
	assert.True(t, ok, "retriever node must be registered as an executable node")
}

func TestBuildRetriever_UndeclaredCollectionFails(t *testing.T) {
	g := retrieverGraph(t, map[string]string{})

	err := g.build([]workflowapi.Node{retrieverNode(t, "r1", "kb-1")}, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "r1")
}

// plainGraph is a minimal graph builder for nodes that need no channels or
// backends (Delay, Ticker, OnStartup).
func plainGraph(t *testing.T) *graph {
	t.Helper()
	ms, err := engine.NewMainScope(nil)
	require.NoError(t, err)
	return newGraph(&buildContext{
		ctx:       context.Background(),
		channels:  &channels{},
		functions: map[string]*engine.Function{},
		mainScope: ms,
	})
}

func tickerNode(t *testing.T, id string) workflowapi.Node {
	t.Helper()
	var tk workflowapi.TickerNode
	tk.Id = id
	tk.Arguments.IntervalValue = pointer.Ptr(1)
	tk.Arguments.IntervalUnit = workflowapi.Seconds
	var n workflowapi.Node
	require.NoError(t, n.FromTickerNode(tk))
	return n
}

func delayNode(t *testing.T, id string) workflowapi.Node {
	t.Helper()
	var d workflowapi.DelayNode
	d.Id = id
	d.Arguments.DelayMs = pointer.Ptr(5)
	var n workflowapi.Node
	require.NoError(t, n.FromDelayNode(d))
	return n
}

func onStartupNode(t *testing.T, id string) workflowapi.Node {
	t.Helper()
	var s workflowapi.OnStartupNode
	s.Id = id
	var n workflowapi.Node
	require.NoError(t, n.FromOnStartupNode(s))
	return n
}

func controlEdge(from, to string) workflowapi.Edge {
	return workflowapi.Edge{
		Id:   from + "->" + to,
		Type: workflowapi.Control,
		From: workflowapi.Vertex{NodeId: from, Port: engine.PortCtrl},
		To:   workflowapi.Vertex{NodeId: to, Port: engine.PortCtrl},
	}
}

func TestBuild_ControlEdgeIntoTriggerRejected(t *testing.T) {
	// A Delay (which is an executable node too) wiring control into a Ticker (a pure
	// source) must fail at build, not crash the runner with "no executable".
	g := plainGraph(t)
	err := g.build(
		[]workflowapi.Node{delayNode(t, "d1"), tickerNode(t, "t1")},
		[]workflowapi.Edge{controlEdge("d1", "t1")},
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "t1")
	assert.Contains(t, err.Error(), "not an executable node")
}

func TestBuild_StartupEdgeIntoTriggerRejected(t *testing.T) {
	g := plainGraph(t)
	err := g.build(
		[]workflowapi.Node{onStartupNode(t, "s1"), tickerNode(t, "t1")},
		[]workflowapi.Edge{controlEdge("s1", "t1")},
	)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not an executable node")
}

func TestBuild_ControlEdgeIntoDelayAllowed(t *testing.T) {
	// The reclassification: Delay is an executable node, so routing control into it (here
	// as the OnStartup entry target) is valid.
	g := plainGraph(t)
	err := g.build(
		[]workflowapi.Node{onStartupNode(t, "s1"), delayNode(t, "d1")},
		[]workflowapi.Edge{controlEdge("s1", "d1")},
	)
	require.NoError(t, err)
	_, isExecutable := g.executables["d1"]
	assert.True(t, isExecutable, "Delay must be registered as an executable node")
	_, isTrigger := g.triggers["d1"]
	assert.True(t, isTrigger, "Delay must also be registered as a trigger")
}
