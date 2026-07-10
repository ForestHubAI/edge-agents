// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package rag

import (
	"database/sql"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// testEnvelope is a minimal but complete data sheet for a three-dimensional store.
func testEnvelope() Envelope {
	return Envelope{
		EmbeddingModel: "test-embed",
		Dimension:      3,
		Metric:         metricCosine,
		Pooling:        "last",
		QueryPrefix:    "query: ",
		DocumentPrefix: "passage: ",
		EOSToken:       "<eos>",
		ChunkSize:      512,
		ChunkOverlap:   64,
		Runtime:        "test",
	}
}

// buildStore writes an artifact whose chunk i carries vecs[i] and contents[i],
// and returns its path. Chunks land under rowid 1..n in the order given.
func buildStore(t *testing.T, env Envelope, vecs [][]float32, contents []string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "index.db")

	w, err := CreateStore(path, env)
	require.NoError(t, err)
	require.NoError(t, w.AddDocument("doc-1", "manual.pdf", "application/pdf"))
	for i, v := range vecs {
		require.NoError(t, w.AddChunk("doc-1", i, contents[i], v))
	}
	require.NoError(t, w.Close())
	return path
}

// axisStore is the shared fixture: three chunks on and between the x/y axes, so
// cosine scores against {1,0,0} are exactly 1, 0 and 1/sqrt(2).
func axisStore(t *testing.T) string {
	t.Helper()
	return buildStore(t, testEnvelope(),
		[][]float32{{1, 0, 0}, {0, 1, 0}, {1, 1, 0}},
		[]string{"on x", "on y", "between"})
}

// openRW reopens an artifact writable, to corrupt it for the negative cases.
func openRW(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", path)
	require.NoError(t, err)
	t.Cleanup(func() { db.Close() })
	return db
}

func TestStore_Roundtrip(t *testing.T) {
	s, err := OpenStore(axisStore(t))
	require.NoError(t, err)
	defer s.Close()

	env := s.Envelope()
	assert.Equal(t, SchemaVersion, env.SchemaVersion)
	assert.Equal(t, "test-embed", env.EmbeddingModel)
	assert.Equal(t, 3, env.Dimension)
	assert.Equal(t, metricCosine, env.Metric)
	assert.Equal(t, "query: ", env.QueryPrefix)
	assert.Equal(t, "passage: ", env.DocumentPrefix)
	assert.Equal(t, "<eos>", env.EOSToken)
	assert.Equal(t, "last", env.Pooling)
	assert.Equal(t, 3, env.VectorCount, "Close backfills the count only the finished write knows")
	assert.NotEmpty(t, env.BuiltAt)
}

func TestStore_SearchRanksByCosine(t *testing.T) {
	s, err := OpenStore(axisStore(t))
	require.NoError(t, err)
	defer s.Close()

	got, err := s.Search([]float32{1, 0, 0}, 2)
	require.NoError(t, err)
	require.Len(t, got, 2)

	assert.Equal(t, int64(1), got[0].RowID)
	assert.InDelta(t, 1.0, got[0].Score, 1e-6)
	assert.Equal(t, int64(3), got[1].RowID)
	assert.InDelta(t, 1/math.Sqrt2, got[1].Score, 1e-6)
}

func TestStore_SearchTopKBeyondSizeReturnsAll(t *testing.T) {
	s, err := OpenStore(axisStore(t))
	require.NoError(t, err)
	defer s.Close()

	for _, topK := range []int{0, -1, 99} {
		got, err := s.Search([]float32{1, 0, 0}, topK)
		require.NoError(t, err)
		assert.Len(t, got, 3, "topK %d", topK)
	}
}

func TestStore_SearchNormalizedStoreSkipsPerVectorNorm(t *testing.T) {
	env := testEnvelope()
	env.Normalized = true
	unit := float32(1 / math.Sqrt2)
	path := buildStore(t, env,
		[][]float32{{1, 0, 0}, {unit, unit, 0}},
		[]string{"on x", "diagonal"})

	s, err := OpenStore(path)
	require.NoError(t, err)
	defer s.Close()

	// The query need not be unit length: only the stored side is assumed normalized.
	got, err := s.Search([]float32{2, 0, 0}, 2)
	require.NoError(t, err)
	assert.InDelta(t, 1.0, got[0].Score, 1e-6)
	assert.InDelta(t, 1/math.Sqrt2, got[1].Score, 1e-6)
}

func TestStore_SearchRejectsUnusableQuery(t *testing.T) {
	s, err := OpenStore(axisStore(t))
	require.NoError(t, err)
	defer s.Close()

	_, err = s.Search([]float32{1, 0}, 1)
	assert.ErrorContains(t, err, "2 dimensions")

	_, err = s.Search([]float32{0, 0, 0}, 1)
	assert.ErrorContains(t, err, "all zeros")
}

func TestStore_FetchKeepsRequestedOrder(t *testing.T) {
	s, err := OpenStore(axisStore(t))
	require.NoError(t, err)
	defer s.Close()

	// Descending rowids: SQL would return them ascending and dissolve the ranking.
	got, err := s.Fetch([]int64{3, 1})
	require.NoError(t, err)
	require.Len(t, got, 2)

	assert.Equal(t, "between", got[0].Content)
	assert.Equal(t, "doc-1:2", got[0].ID)
	assert.Equal(t, "doc-1", got[0].DocumentID)
	assert.Equal(t, "on x", got[1].Content)
}

func TestStore_FetchEmptyAndMissing(t *testing.T) {
	s, err := OpenStore(axisStore(t))
	require.NoError(t, err)
	defer s.Close()

	got, err := s.Fetch(nil)
	require.NoError(t, err)
	assert.Empty(t, got)

	_, err = s.Fetch([]int64{1, 42})
	assert.ErrorContains(t, err, "rowid 42 not found")
}

func TestStore_WriterPopulatesTermIndex(t *testing.T) {
	path := buildStore(t, testEnvelope(),
		[][]float32{{1, 0, 0}, {0, 1, 0}},
		[]string{"error code E-4711 at the filter", "unrelated text"})

	db := openRW(t, path)
	var content string
	err := db.QueryRow(
		`SELECT content FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts)`,
		`"E-4711"`).Scan(&content)
	require.NoError(t, err)
	assert.Equal(t, "error code E-4711 at the filter", content)
}

func TestOpenStore_RejectsMissingFile(t *testing.T) {
	_, err := OpenStore(filepath.Join(t.TempDir(), "absent.db"))
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestOpenStore_RejectsBadEnvelope(t *testing.T) {
	tests := []struct {
		name    string
		corrupt string
		wantErr string
	}{
		{"no row", `DELETE FROM envelope`, "exactly one row, found 0"},
		{"two rows", `INSERT INTO envelope SELECT * FROM envelope`, "exactly one row, found 2"},
		{"future schema", `UPDATE envelope SET schema_version = 99`, "newer than supported"},
		{"wrong metric", `UPDATE envelope SET metric = 'euclidean'`, "unsupported metric"},
		{"no dimension", `UPDATE envelope SET dimension = 0`, "invalid dimension"},
		{"no model", `UPDATE envelope SET embedding_model = ''`, "no embedding model"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			path := axisStore(t)
			_, err := openRW(t, path).Exec(tc.corrupt)
			require.NoError(t, err)

			_, err = OpenStore(path)
			assert.ErrorContains(t, err, tc.wantErr)
		})
	}
}

func TestOpenStore_RejectsVectorOfWrongWidth(t *testing.T) {
	path := axisStore(t)
	_, err := openRW(t, path).Exec(`UPDATE chunks SET embedding = X'0000' WHERE rowid = 2`)
	require.NoError(t, err)

	_, err = OpenStore(path)
	assert.ErrorContains(t, err, "rowid 2: embedding is 2 bytes, want 12")
}

func TestCreateStore_RejectsUnusableEnvelope(t *testing.T) {
	dir := t.TempDir()

	env := testEnvelope()
	env.Dimension = 0
	_, err := CreateStore(filepath.Join(dir, "a.db"), env)
	assert.ErrorContains(t, err, "invalid dimension")

	env = testEnvelope()
	env.EmbeddingModel = ""
	_, err = CreateStore(filepath.Join(dir, "b.db"), env)
	assert.ErrorContains(t, err, "no embedding model")

	env = testEnvelope()
	env.Metric = "euclidean"
	_, err = CreateStore(filepath.Join(dir, "c.db"), env)
	assert.ErrorContains(t, err, "unsupported metric")
}

func TestCreateStore_RefusesToOverwrite(t *testing.T) {
	path := axisStore(t)
	_, err := CreateStore(path, testEnvelope())
	assert.ErrorContains(t, err, "already exists")
}

func TestStoreWriter_AddChunkRejectsWrongWidth(t *testing.T) {
	w, err := CreateStore(filepath.Join(t.TempDir(), "index.db"), testEnvelope())
	require.NoError(t, err)
	defer w.Close()

	require.NoError(t, w.AddDocument("doc-1", "", ""))
	err = w.AddChunk("doc-1", 0, "text", []float32{1, 0})
	assert.ErrorContains(t, err, "vector has 2 dimensions, envelope declares 3")
}

func TestEncodeVector_RoundtripsLittleEndian(t *testing.T) {
	want := []float32{1.5, -2.25, 3.75}
	blob := encodeVector(want)
	require.Len(t, blob, len(want)*4)
	assert.Equal(t, want, appendVector(nil, blob))
}
