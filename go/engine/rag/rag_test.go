// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package rag

import (
	"context"
	"errors"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeEmbedder captures the request and returns a canned vector.
type fakeEmbedder struct {
	gotModel  llmproxy.ModelID
	gotInputs []string
	vectors   [][]float32
	err       error
}

func (f *fakeEmbedder) Embed(_ context.Context, req *llmproxy.EmbeddingRequest) (*llmproxy.EmbeddingResponse, error) {
	f.gotModel = req.Model
	f.gotInputs = req.Inputs
	if f.err != nil {
		return nil, f.err
	}
	return &llmproxy.EmbeddingResponse{Embeddings: f.vectors}, nil
}

// retrieverOn opens the axis fixture and wires it to the given embedder.
func retrieverOn(t *testing.T, e Embedder) *LocalRetriever {
	t.Helper()
	s, err := OpenStore(axisStore(t))
	require.NoError(t, err)
	r := NewLocalRetriever(s, e)
	t.Cleanup(func() { r.Close() })
	return r
}

func TestLocalRetriever_QueryRAGRanksAndLoadsPayload(t *testing.T) {
	fake := &fakeEmbedder{vectors: [][]float32{{1, 0, 0}}}
	r := retrieverOn(t, fake)

	got, err := r.QueryRAG(context.Background(), engine.RAGQueryParams{Query: "where?", TopK: 2})
	require.NoError(t, err)
	require.Len(t, got, 2)

	assert.Equal(t, "on x", got[0].Content)
	assert.Equal(t, "doc-1:0", got[0].ChunkID)
	assert.Equal(t, "doc-1", got[0].DocumentID)
	assert.InDelta(t, 1.0, got[0].Score, 1e-6)
	assert.Equal(t, "between", got[1].Content)
	assert.Less(t, got[1].Score, got[0].Score)
}

func TestLocalRetriever_QueryRAGAppliesEnvelopeProfile(t *testing.T) {
	fake := &fakeEmbedder{vectors: [][]float32{{1, 0, 0}}}
	r := retrieverOn(t, fake)

	_, err := r.QueryRAG(context.Background(), engine.RAGQueryParams{Query: "where?"})
	require.NoError(t, err)

	// The query is dressed exactly as the envelope prescribes, and the model id
	// comes from the artifact, so it cannot disagree with what built it.
	assert.Equal(t, []string{"query: where?<eos>"}, fake.gotInputs)
	assert.Equal(t, llmproxy.ModelID("test-embed"), fake.gotModel)
}

func TestLocalRetriever_QueryRAGDefaultsTopK(t *testing.T) {
	fake := &fakeEmbedder{vectors: [][]float32{{1, 0, 0}}}
	r := retrieverOn(t, fake)

	// Fixture holds three chunks, fewer than the default of five.
	got, err := r.QueryRAG(context.Background(), engine.RAGQueryParams{Query: "where?", TopK: 0})
	require.NoError(t, err)
	assert.Len(t, got, 3)
}

func TestLocalRetriever_QueryRAGRejectsForeignDimension(t *testing.T) {
	fake := &fakeEmbedder{vectors: [][]float32{{1, 0}}}
	r := retrieverOn(t, fake)

	_, err := r.QueryRAG(context.Background(), engine.RAGQueryParams{Query: "where?"})
	assert.ErrorContains(t, err, "model test-embed returned 2 dimensions, store expects 3")
}

func TestLocalRetriever_QueryRAGRejectsUnexpectedVectorCount(t *testing.T) {
	fake := &fakeEmbedder{vectors: [][]float32{{1, 0, 0}, {0, 1, 0}}}
	r := retrieverOn(t, fake)

	_, err := r.QueryRAG(context.Background(), engine.RAGQueryParams{Query: "where?"})
	assert.ErrorContains(t, err, "returned 2 vectors, want 1")
}

func TestLocalRetriever_QueryRAGPropagatesEmbedderError(t *testing.T) {
	sentinel := errors.New("endpoint unreachable")
	r := retrieverOn(t, &fakeEmbedder{err: sentinel})

	_, err := r.QueryRAG(context.Background(), engine.RAGQueryParams{Query: "where?"})
	assert.ErrorIs(t, err, sentinel)
}
