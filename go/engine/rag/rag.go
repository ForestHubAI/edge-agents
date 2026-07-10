// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package rag answers retrieval queries from an artifact on the device, with no
// retrieval service involved. The artifact (index.db) carries the chunks, their
// embeddings and an envelope describing the model that produced them; this
// package both writes it and reads it, so the two sides cannot drift apart.
package rag

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

// Implementation guard
var _ engine.Retriever = (*LocalRetriever)(nil)

// defaultTopK is the number of chunks returned when the query declares none.
const defaultTopK = 5

// Embedder turns a query into a vector. It is declared here rather than among
// the engine ports because embedding is what this retriever needs, not what the
// engine needs: a deployment answered by a retrieval service embeds nothing
// locally. Satisfied by llmproxy.Client.
type Embedder interface {
	Embed(ctx context.Context, req *llmproxy.EmbeddingRequest) (*llmproxy.EmbeddingResponse, error)
}

// LocalRetriever answers queries from one opened store. A deployment builds one
// per vector database, so the collection id of an incoming query is already
// implied by the retriever that receives it.
type LocalRetriever struct {
	store    *Store
	embedder Embedder
}

// NewLocalRetriever binds an opened store to the embedding endpoint serving the
// model named in its envelope.
func NewLocalRetriever(store *Store, e Embedder) *LocalRetriever {
	return &LocalRetriever{store: store, embedder: e}
}

// Close releases the store.
func (r *LocalRetriever) Close() error { return r.store.Close() }

// QueryRAG embeds the query the way the documents were embedded, ranks the
// stored vectors against it, and loads the payload of the best ones. The
// dimension check is the last defense against an artifact and an endpoint that
// disagree: a vector of the wrong width still yields scores, just meaningless
// ones.
func (r *LocalRetriever) QueryRAG(ctx context.Context, params engine.RAGQueryParams) ([]engine.RAGQueryResult, error) {
	env := r.store.Envelope()

	topK := params.TopK
	if topK <= 0 {
		topK = defaultTopK
	}

	resp, err := r.embedder.Embed(ctx, &llmproxy.EmbeddingRequest{
		Model:  llmproxy.ModelID(env.EmbeddingModel),
		Inputs: []string{env.QueryPrefix + params.Query + env.EOSToken},
	})
	if err != nil {
		return nil, fmt.Errorf("embedding query: %w", err)
	}
	if len(resp.Embeddings) != 1 {
		return nil, fmt.Errorf("embedding returned %d vectors, want 1", len(resp.Embeddings))
	}
	query := resp.Embeddings[0]
	if len(query) != env.Dimension {
		return nil, fmt.Errorf("model %s returned %d dimensions, store expects %d",
			env.EmbeddingModel, len(query), env.Dimension)
	}

	hits, err := r.store.Search(query, topK)
	if err != nil {
		return nil, fmt.Errorf("searching store: %w", err)
	}

	rowids := make([]int64, len(hits))
	for i, h := range hits {
		rowids[i] = h.RowID
	}
	chunks, err := r.store.Fetch(rowids)
	if err != nil {
		return nil, fmt.Errorf("loading results: %w", err)
	}

	out := make([]engine.RAGQueryResult, len(chunks))
	for i, c := range chunks {
		out[i] = engine.RAGQueryResult{
			ChunkID:    c.ID,
			DocumentID: c.DocumentID,
			Content:    c.Content,
			Score:      hits[i].Score,
		}
	}
	return out, nil
}
