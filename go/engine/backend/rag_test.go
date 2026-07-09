// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package backend

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestQueryRAG_Success(t *testing.T) {
	var (
		gotKey    string
		gotMethod string
		gotPath   string
		gotBody   []byte
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotKey = r.Header.Get("Device-Key")
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[
			{"chunkId":"c1","documentId":"d1","content":"hello","score":0.91},
			{"chunkId":"c2","documentId":"d1","content":"world","score":0.42}
		]`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	got, err := c.QueryRAG(context.Background(), engine.RAGQueryParams{
		CollectionID: "kb-main",
		Query:        "how do I deploy?",
		TopK:         5,
	})
	require.NoError(t, err)
	assert.Equal(t, http.MethodPost, gotMethod)
	assert.Equal(t, "/rag/query", gotPath)
	assert.Equal(t, "secret", gotKey)
	assert.JSONEq(t, `{"collectionId":"kb-main","query":"how do I deploy?","topK":5}`, string(gotBody))

	require.Len(t, got, 2)
	assert.Equal(t, engine.RAGQueryResult{ChunkID: "c1", DocumentID: "d1", Content: "hello", Score: 0.91}, got[0])
	assert.Equal(t, engine.RAGQueryResult{ChunkID: "c2", DocumentID: "d1", Content: "world", Score: 0.42}, got[1])
}

func TestQueryRAG_EmptyResults(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[]`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	got, err := c.QueryRAG(context.Background(), engine.RAGQueryParams{CollectionID: "kb", Query: "q", TopK: 3})
	require.NoError(t, err)
	assert.Empty(t, got)
}

func TestQueryRAG_BackendError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	_, err := c.QueryRAG(context.Background(), engine.RAGQueryParams{CollectionID: "kb", Query: "q", TopK: 3})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}
