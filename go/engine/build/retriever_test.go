// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/rag"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// writeStore creates a usable artifact under ragDir/<name>/index.db.
func writeStore(t *testing.T, ragDir, name string) {
	t.Helper()
	require.NoError(t, os.MkdirAll(filepath.Join(ragDir, name), 0o755))

	w, err := rag.CreateStore(filepath.Join(ragDir, name, "index.db"), rag.Envelope{
		EmbeddingModel: "test-embed",
		Dimension:      3,
	})
	require.NoError(t, err)
	require.NoError(t, w.AddDocument("doc-1", "manual.pdf", "application/pdf"))
	require.NoError(t, w.AddChunk("doc-1", 0, "on x", []float32{1, 0, 0}))
	require.NoError(t, w.Close())
}

func vectorStore(url, store string) engine.VectorStoreConfig {
	return engine.VectorStoreConfig{URL: url, Store: store}
}

func TestBuildRetrieverStep_LocalStoreWins(t *testing.T) {
	ragDir := t.TempDir()
	writeStore(t, ragDir, "manuals")

	ext := &engine.ExternalResources{VectorStores: map[string]engine.VectorStoreConfig{
		"vdb-1": vectorStore("http://embed:8080", "manuals"),
	}}
	lookup, err := buildRetriever(map[string]string{"kb-1": "vdb-1"}, ext, ragDir, stubRetriever{})
	require.NoError(t, err)

	ret := lookup("vdb-1")
	require.NotNil(t, ret)
	assert.IsType(t, &rag.LocalRetriever{}, ret, "a bound vector store must not fall back")
}

func TestBuildRetrieverStep_FallsBackWhenUnbound(t *testing.T) {
	lookup, err := buildRetriever(map[string]string{"kb-1": "remote-collection"}, nil, t.TempDir(), stubRetriever{})
	require.NoError(t, err)

	assert.Equal(t, stubRetriever{}, lookup("remote-collection"))
}

func TestBuildRetrieverStep_NilWithoutStoreOrFallback(t *testing.T) {
	lookup, err := buildRetriever(map[string]string{"kb-1": "remote-collection"}, nil, t.TempDir(), nil)
	require.NoError(t, err)

	assert.Nil(t, lookup("remote-collection"), "the graph turns this into a build error")
}

func TestBuildRetrieverStep_MixedRouting(t *testing.T) {
	ragDir := t.TempDir()
	writeStore(t, ragDir, "manuals")

	ext := &engine.ExternalResources{VectorStores: map[string]engine.VectorStoreConfig{
		"vdb-1": vectorStore("http://embed:8080", "manuals"),
	}}
	collections := map[string]string{"kb-1": "vdb-1", "kb-2": "remote-collection"}

	lookup, err := buildRetriever(collections, ext, ragDir, stubRetriever{})
	require.NoError(t, err)

	assert.IsType(t, &rag.LocalRetriever{}, lookup("vdb-1"))
	assert.Equal(t, stubRetriever{}, lookup("remote-collection"))
}

func TestBuildRetrieverStep_SharedStoreOpensOnce(t *testing.T) {
	ragDir := t.TempDir()
	writeStore(t, ragDir, "manuals")

	ext := &engine.ExternalResources{VectorStores: map[string]engine.VectorStoreConfig{
		"vdb-1": vectorStore("http://embed:8080", "manuals"),
	}}
	// Two vector databases bound to the same resource share one retriever.
	lookup, err := buildRetriever(map[string]string{"kb-1": "vdb-1", "kb-2": "vdb-1"}, ext, ragDir, nil)
	require.NoError(t, err)

	assert.Same(t, lookup("vdb-1"), lookup("vdb-1"))
}

func TestBuildRetrieverStep_MissingArtifactFailsBoot(t *testing.T) {
	ext := &engine.ExternalResources{VectorStores: map[string]engine.VectorStoreConfig{
		"vdb-1": vectorStore("http://embed:8080", "absent"),
	}}
	_, err := buildRetriever(map[string]string{"kb-1": "vdb-1"}, ext, t.TempDir(), stubRetriever{})

	// The vector database and the store are both named, and a fallback does not rescue it.
	assert.ErrorContains(t, err, `vector database "kb-1"`)
	assert.ErrorContains(t, err, `store "absent"`)
}

func TestBuildRetrieverStep_UnreferencedBrokenResourceBoots(t *testing.T) {
	ext := &engine.ExternalResources{VectorStores: map[string]engine.VectorStoreConfig{
		"vdb-unused": vectorStore("http://embed:8080", "absent"),
	}}
	// Nothing points at it, so it is never opened.
	lookup, err := buildRetriever(map[string]string{"kb-1": "remote-collection"}, ext, t.TempDir(), stubRetriever{})
	require.NoError(t, err)
	assert.Equal(t, stubRetriever{}, lookup("remote-collection"))
}

func TestBuildRetrieverStep_RejectsStoreNameEscapingTheMount(t *testing.T) {
	tests := []struct{ name, wantErr string }{
		{"", "store name is empty"},
		{"..", "plain directory name"},
		{"../etc", "plain directory name"},
		{"sub/dir", "plain directory name"},
		{`sub\dir`, "plain directory name"},
		{"a/../../b", "plain directory name"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ext := &engine.ExternalResources{VectorStores: map[string]engine.VectorStoreConfig{
				"vdb-1": vectorStore("http://embed:8080", tc.name),
			}}
			_, err := buildRetriever(map[string]string{"kb-1": "vdb-1"}, ext, t.TempDir(), nil)
			// The name must be rejected before it ever becomes a path, so the
			// error is the gate's — not a missing file further down.
			assert.ErrorContains(t, err, tc.wantErr)
		})
	}
}
