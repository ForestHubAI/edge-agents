// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package rag

import (
	"database/sql"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/ForestHubAI/edge-agents/go/logging"

	_ "modernc.org/sqlite" // cgo-free driver, registered as "sqlite"
)

// SchemaVersion is the artifact layout this package writes, and the highest one
// it reads. A store built by a newer writer is rejected rather than guessed at.
const SchemaVersion = 1

// metricCosine is the only similarity metric implemented here. It is recorded in
// the envelope so a store built for another metric fails loudly instead of
// silently ranking by the wrong distance.
const metricCosine = "cosine"

// schemaSQL is the complete artifact layout. chunks_fts is an external-content
// index: it stores only the inverted terms and refers back to chunks by rowid,
// which is therefore the stable join key across the vector, text and term sides.
const schemaSQL = `
CREATE TABLE envelope (
  schema_version  INTEGER NOT NULL,
  embedding_model TEXT NOT NULL,
  dimension       INTEGER NOT NULL,
  metric          TEXT NOT NULL,
  normalized      INTEGER NOT NULL,
  pooling         TEXT,
  query_prefix    TEXT DEFAULT '',
  document_prefix TEXT DEFAULT '',
  eos_token       TEXT DEFAULT '',
  chunk_size      INTEGER,
  chunk_overlap   INTEGER,
  vector_count    INTEGER,
  built_at        TEXT,
  runtime         TEXT
);
CREATE TABLE documents (
  id           TEXT PRIMARY KEY,
  filename     TEXT,
  content_type TEXT
);
CREATE TABLE chunks (
  id          TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  chunk_index INTEGER NOT NULL,
  content     TEXT NOT NULL,
  embedding   BLOB NOT NULL
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(content, content=chunks, content_rowid=rowid);
`

// Envelope is the machine-readable data sheet of a store: what embedded it, how,
// and how much. Everything a reader needs to decide whether it may use the
// artifact at all, and how to phrase a query so it lands in the same vector space
// as the documents.
type Envelope struct {
	SchemaVersion  int
	EmbeddingModel string
	Dimension      int
	Metric         string
	Normalized     bool
	Pooling        string
	QueryPrefix    string
	DocumentPrefix string
	EOSToken       string
	ChunkSize      int
	ChunkOverlap   int
	VectorCount    int
	BuiltAt        string
	Runtime        string
}

// Result is one ranked hit of a similarity search: the row it points at and how
// close it was. The payload is deliberately absent — see Store.Fetch.
type Result struct {
	RowID int64
	Score float64
}

// Chunk is the stored payload of one row, loaded on demand for ranked hits.
type Chunk struct {
	RowID      int64
	ID         string
	DocumentID string
	Content    string
}

// Store is a read-only view of an index.db.
//
// Only the vectors are held in memory: one contiguous float32 block (vector i
// starts at i*Dimension) plus the parallel rowids. Chunk text stays on disk —
// a search touches every vector but no text, and the few ranked hits are read
// back through the open connection. Memory is therefore exactly
// vector_count × dimension × 4 bytes, and predictable from the envelope alone.
type Store struct {
	db      *sql.DB
	env     Envelope
	rowids  []int64
	vectors []float32
}

// OpenStore opens an artifact read-only, validates its envelope and loads the
// vectors. The file is stat'ed first because database/sql connects lazily — a
// missing artifact must fail here, not on the first query.
func OpenStore(path string) (*Store, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("rag store: %w", err)
	}

	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		return nil, fmt.Errorf("opening rag store %s: %w", path, err)
	}

	env, err := readEnvelope(db)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("rag store %s: %w", path, err)
	}

	logging.Logger.Info().
		Str("store", path).
		Str("model", env.EmbeddingModel).
		Int("vectors", env.VectorCount).
		Int("dimension", env.Dimension).
		Int64("vector-bytes", int64(env.VectorCount)*int64(env.Dimension)*4).
		Msg("loading rag store")

	rowids, vectors, err := loadVectors(db, env)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("rag store %s: %w", path, err)
	}

	return &Store{db: db, env: env, rowids: rowids, vectors: vectors}, nil
}

// Envelope returns the validated data sheet of the opened store.
func (s *Store) Envelope() Envelope { return s.env }

// Close releases the connection kept open for payload lookups.
func (s *Store) Close() error { return s.db.Close() }

// Search ranks every stored vector against query by cosine similarity and
// returns the topK best, highest score first. Ties keep the lower rowid, so the
// ranking is stable across runs. topK <= 0 or beyond the store size yields all
// vectors.
func (s *Store) Search(query []float32, topK int) ([]Result, error) {
	dim := s.env.Dimension
	if len(query) != dim {
		return nil, fmt.Errorf("query vector has %d dimensions, store has %d", len(query), dim)
	}
	queryNorm := norm(query)
	if queryNorm == 0 {
		return nil, fmt.Errorf("query vector is all zeros")
	}
	if topK <= 0 || topK > len(s.rowids) {
		topK = len(s.rowids)
	}

	out := make([]Result, 0, topK)
	for i, rowid := range s.rowids {
		vec := s.vectors[i*dim : (i+1)*dim]
		// Stored vectors are unit length when the envelope says so, which
		// reduces cosine to a dot product scaled by the query norm alone.
		denom := queryNorm
		if !s.env.Normalized {
			denom *= norm(vec)
		}
		if denom == 0 {
			continue
		}
		out = insertRanked(out, Result{RowID: rowid, Score: dot(query, vec) / denom}, topK)
	}
	return out, nil
}

// Fetch loads the payload of the given rows and returns it in the order asked
// for. SQL results are unordered, so the ranking would dissolve if the rows were
// returned as the engine happened to emit them. A rowid without a row is an
// error: it means the vectors and the table have drifted apart.
func (s *Store) Fetch(rowids []int64) ([]Chunk, error) {
	if len(rowids) == 0 {
		return nil, nil
	}

	args := make([]any, len(rowids))
	for i, id := range rowids {
		args[i] = id
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(rowids)), ",")

	rows, err := s.db.Query(
		`SELECT rowid, id, document_id, content FROM chunks WHERE rowid IN (`+placeholders+`)`, args...)
	if err != nil {
		return nil, fmt.Errorf("fetching chunks: %w", err)
	}
	defer rows.Close()

	found := make(map[int64]Chunk, len(rowids))
	for rows.Next() {
		var c Chunk
		if err := rows.Scan(&c.RowID, &c.ID, &c.DocumentID, &c.Content); err != nil {
			return nil, fmt.Errorf("scanning chunk: %w", err)
		}
		found[c.RowID] = c
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("fetching chunks: %w", err)
	}

	out := make([]Chunk, len(rowids))
	for i, id := range rowids {
		c, ok := found[id]
		if !ok {
			return nil, fmt.Errorf("chunk rowid %d not found", id)
		}
		out[i] = c
	}
	return out, nil
}

// readEnvelope reads and validates the single envelope row. The gates are the
// artifact's admission criteria: exactly one row, a layout this build
// understands, the metric it can actually compute, and a usable dimension.
func readEnvelope(db *sql.DB) (Envelope, error) {
	var count int
	if err := db.QueryRow(`SELECT count(*) FROM envelope`).Scan(&count); err != nil {
		return Envelope{}, fmt.Errorf("reading envelope: %w", err)
	}
	if count != 1 {
		return Envelope{}, fmt.Errorf("envelope must hold exactly one row, found %d", count)
	}

	var (
		env                                       Envelope
		normalized                                int
		pooling, queryPrefix, docPrefix, eosToken sql.NullString
		builtAt, runtime                          sql.NullString
		chunkSize, chunkOverlap, vectorCount      sql.NullInt64
	)
	err := db.QueryRow(`
		SELECT schema_version, embedding_model, dimension, metric, normalized,
		       pooling, query_prefix, document_prefix, eos_token,
		       chunk_size, chunk_overlap, vector_count, built_at, runtime
		FROM envelope`).
		Scan(&env.SchemaVersion, &env.EmbeddingModel, &env.Dimension, &env.Metric, &normalized,
			&pooling, &queryPrefix, &docPrefix, &eosToken,
			&chunkSize, &chunkOverlap, &vectorCount, &builtAt, &runtime)
	if err != nil {
		return Envelope{}, fmt.Errorf("reading envelope: %w", err)
	}

	env.Normalized = normalized != 0
	env.Pooling = pooling.String
	env.QueryPrefix = queryPrefix.String
	env.DocumentPrefix = docPrefix.String
	env.EOSToken = eosToken.String
	env.ChunkSize = int(chunkSize.Int64)
	env.ChunkOverlap = int(chunkOverlap.Int64)
	env.VectorCount = int(vectorCount.Int64)
	env.BuiltAt = builtAt.String
	env.Runtime = runtime.String

	if env.SchemaVersion > SchemaVersion {
		return Envelope{}, fmt.Errorf("schema version %d is newer than supported version %d",
			env.SchemaVersion, SchemaVersion)
	}
	if env.Metric != metricCosine {
		return Envelope{}, fmt.Errorf("unsupported metric %q, want %q", env.Metric, metricCosine)
	}
	if env.Dimension <= 0 {
		return Envelope{}, fmt.Errorf("invalid dimension %d", env.Dimension)
	}
	if env.EmbeddingModel == "" {
		return Envelope{}, fmt.Errorf("envelope names no embedding model")
	}
	return env, nil
}

// loadVectors reads rowid and embedding of every chunk into one contiguous
// block. Nothing else is kept: the remaining columns cost a multiple of the
// vector per chunk and are never touched while searching.
func loadVectors(db *sql.DB, env Envelope) ([]int64, []float32, error) {
	rows, err := db.Query(`SELECT rowid, embedding FROM chunks ORDER BY rowid`)
	if err != nil {
		return nil, nil, fmt.Errorf("loading vectors: %w", err)
	}
	defer rows.Close()

	rowids := make([]int64, 0, env.VectorCount)
	vectors := make([]float32, 0, env.VectorCount*env.Dimension)
	for rows.Next() {
		var (
			rowid int64
			blob  []byte
		)
		if err := rows.Scan(&rowid, &blob); err != nil {
			return nil, nil, fmt.Errorf("scanning vector: %w", err)
		}
		if len(blob) != env.Dimension*4 {
			return nil, nil, fmt.Errorf("chunk rowid %d: embedding is %d bytes, want %d",
				rowid, len(blob), env.Dimension*4)
		}
		rowids = append(rowids, rowid)
		vectors = appendVector(vectors, blob)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("loading vectors: %w", err)
	}
	return rowids, vectors, nil
}

// insertRanked keeps ranked sorted by descending score and capped at k, dropping
// the weakest entry once it is full.
func insertRanked(ranked []Result, cand Result, k int) []Result {
	if len(ranked) == k && cand.Score <= ranked[len(ranked)-1].Score {
		return ranked
	}
	at := sort.Search(len(ranked), func(i int) bool { return ranked[i].Score < cand.Score })
	if len(ranked) < k {
		ranked = append(ranked, Result{})
	}
	copy(ranked[at+1:], ranked[at:])
	ranked[at] = cand
	return ranked
}

func dot(a, b []float32) float64 {
	var sum float64
	for i := range a {
		sum += float64(a[i]) * float64(b[i])
	}
	return sum
}

func norm(v []float32) float64 {
	return math.Sqrt(dot(v, v))
}

// StoreWriter builds an artifact. Documents and chunks accumulate in one
// transaction; Close finalises the envelope counters and commits.
type StoreWriter struct {
	db     *sql.DB
	tx     *sql.Tx
	env    Envelope
	chunks int
}

// CreateStore creates a new artifact at path and stamps its envelope. The file
// must not exist: an artifact is built once and shipped read-only, never
// appended to in place.
func CreateStore(path string, env Envelope) (*StoreWriter, error) {
	if env.Dimension <= 0 {
		return nil, fmt.Errorf("invalid dimension %d", env.Dimension)
	}
	if env.EmbeddingModel == "" {
		return nil, fmt.Errorf("envelope names no embedding model")
	}
	if env.Metric == "" {
		env.Metric = metricCosine
	}
	if env.Metric != metricCosine {
		return nil, fmt.Errorf("unsupported metric %q, want %q", env.Metric, metricCosine)
	}
	env.SchemaVersion = SchemaVersion

	if _, err := os.Stat(path); err == nil {
		return nil, fmt.Errorf("rag store %s already exists", path)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("creating rag store %s: %w", path, err)
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("creating schema: %w", err)
	}

	normalized := 0
	if env.Normalized {
		normalized = 1
	}
	_, err = db.Exec(`
		INSERT INTO envelope (schema_version, embedding_model, dimension, metric, normalized,
		                      pooling, query_prefix, document_prefix, eos_token,
		                      chunk_size, chunk_overlap, vector_count, built_at, runtime)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', ?)`,
		env.SchemaVersion, env.EmbeddingModel, env.Dimension, env.Metric, normalized,
		env.Pooling, env.QueryPrefix, env.DocumentPrefix, env.EOSToken,
		env.ChunkSize, env.ChunkOverlap, env.Runtime)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("writing envelope: %w", err)
	}

	tx, err := db.Begin()
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("beginning write: %w", err)
	}
	return &StoreWriter{db: db, tx: tx, env: env}, nil
}

// AddDocument registers the source a later AddChunk refers to.
func (w *StoreWriter) AddDocument(id, filename, contentType string) error {
	if id == "" {
		return fmt.Errorf("document needs an id")
	}
	_, err := w.tx.Exec(`INSERT INTO documents (id, filename, content_type) VALUES (?, ?, ?)`,
		id, filename, contentType)
	if err != nil {
		return fmt.Errorf("adding document %s: %w", id, err)
	}
	return nil
}

// AddChunk stores one embedded chunk and mirrors its text into the term index.
// The external-content index does not observe the base table, so both writes
// belong together.
func (w *StoreWriter) AddChunk(docID string, index int, content string, vec []float32) error {
	if len(vec) != w.env.Dimension {
		return fmt.Errorf("chunk %s/%d: vector has %d dimensions, envelope declares %d",
			docID, index, len(vec), w.env.Dimension)
	}

	id := fmt.Sprintf("%s:%d", docID, index)
	res, err := w.tx.Exec(
		`INSERT INTO chunks (id, document_id, chunk_index, content, embedding) VALUES (?, ?, ?, ?, ?)`,
		id, docID, index, content, encodeVector(vec))
	if err != nil {
		return fmt.Errorf("adding chunk %s: %w", id, err)
	}
	rowid, err := res.LastInsertId()
	if err != nil {
		return fmt.Errorf("adding chunk %s: %w", id, err)
	}
	if _, err := w.tx.Exec(`INSERT INTO chunks_fts (rowid, content) VALUES (?, ?)`, rowid, content); err != nil {
		return fmt.Errorf("indexing chunk %s: %w", id, err)
	}

	w.chunks++
	return nil
}

// Close finalises the counters that only the completed write knows and commits.
// On any failure the transaction is rolled back, leaving a store without chunks
// rather than a plausible-looking but truncated one.
func (w *StoreWriter) Close() error {
	defer w.db.Close()

	builtAt := w.env.BuiltAt
	if builtAt == "" {
		builtAt = time.Now().UTC().Format(time.RFC3339)
	}
	if _, err := w.tx.Exec(`UPDATE envelope SET vector_count = ?, built_at = ?`, w.chunks, builtAt); err != nil {
		w.tx.Rollback()
		return fmt.Errorf("finalising envelope: %w", err)
	}
	if err := w.tx.Commit(); err != nil {
		return fmt.Errorf("committing rag store: %w", err)
	}
	return nil
}

// encodeVector serialises a vector as little-endian float32, the on-disk form of
// the embedding column.
func encodeVector(v []float32) []byte {
	blob := make([]byte, len(v)*4)
	for i, f := range v {
		binary.LittleEndian.PutUint32(blob[i*4:], math.Float32bits(f))
	}
	return blob
}

// appendVector decodes blob onto dst. The caller has already checked the length.
func appendVector(dst []float32, blob []byte) []float32 {
	for i := 0; i < len(blob); i += 4 {
		dst = append(dst, math.Float32frombits(binary.LittleEndian.Uint32(blob[i:])))
	}
	return dst
}
