// Package local provides the offline default for the MemoryStore port: a
// filesystem-backed durable store that lets the engine run with zero
// ForestHub account. There is no offline ControlPlane (a nil one means "no
// supervisor to report to") and no offline Retriever — a workflow with a
// Retriever node fails the build unless a real RAG backend is wired (see
// engine/build).
package local

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
)

// MemoryStore is a filesystem-backed engine.memoryStore. The durable copy is
// a directory of <uid>.json files, so declared memory survives engine
// restarts with no backend.
type MemoryStore struct{ dir string }

// NewMemoryStore returns a filesystem MemoryStore rooted at dir.
func NewMemoryStore(dir string) *MemoryStore { return &MemoryStore{dir: dir} }

// Snapshot reads every <uid>.json under dir. A missing dir is "no memory yet".
func (s *MemoryStore) Snapshot(_ context.Context) ([]workflow.MemoryFile, error) {
	entries, err := os.ReadDir(s.dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []workflow.MemoryFile
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			return nil, err
		}
		var mf workflow.MemoryFile
		if err := json.Unmarshal(b, &mf); err != nil {
			return nil, err
		}
		out = append(out, mf)
	}
	return out, nil
}

// Upsert writes content for uid, preserving any existing metadata.
func (s *MemoryStore) Upsert(_ context.Context, uid, content string) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(s.dir, uid+".json")
	mf := workflow.MemoryFile{Id: uid, Content: content}
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &mf)
		mf.Content = content
	}
	b, err := json.Marshal(mf)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}
