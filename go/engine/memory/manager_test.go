package memory

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubMemorySync is a hand-rolled engine.MemorySync for exercising the
// Manager without an HTTP adapter. The generated MockMemorySync lives in the
// engine package's own test binary and isn't importable here, so a local
// double is the practical choice. Hydrate returns the configured slice;
// Push records each call and optionally fails with pushErr.
type stubMemorySync struct {
	hydrate      []workflow.MemoryFile
	hydrateCalls int
	pushes       []memoryPush
	pushErr      error
}

type memoryPush struct {
	uid     string
	content string
}

func (s *stubMemorySync) Hydrate(_ context.Context) ([]workflow.MemoryFile, error) {
	s.hydrateCalls++
	return s.hydrate, nil
}

func (s *stubMemorySync) Push(_ context.Context, uid, content string) error {
	if s.pushErr != nil {
		return s.pushErr
	}
	s.pushes = append(s.pushes, memoryPush{uid: uid, content: content})
	return nil
}

// mf is a terse MemoryFile builder for declarations and snapshots.
func mf(id, label, content string) workflow.MemoryFile {
	return workflow.MemoryFile{Id: id, Label: label, Description: label, Content: content}
}

// writeLocalRecord seeds a <uid>.json record directly, simulating a warm
// volume left behind by a prior run.
func writeLocalRecord(t *testing.T, dir string, f workflow.MemoryFile) {
	t.Helper()
	require.NoError(t, os.MkdirAll(dir, 0o755))
	b, err := json.Marshal(f)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, f.Id+".json"), b, 0o644))
}

func TestManager_Restore_SeedsFromDeclaredWhenLocalEmpty(t *testing.T) {
	// Standalone: no mirror, empty local dir. Declared content is the seed.
	mgr := NewManager(t.TempDir(), nil)
	declared := []workflow.MemoryFile{mf("uid-notes", "notes", "hello"), mf("uid-log", "log", "")}
	require.NoError(t, mgr.Restore(context.Background(), declared))

	got, err := mgr.Read("uid-notes")
	require.NoError(t, err)
	assert.Equal(t, "hello", got)

	card, err := mgr.Card("uid-notes")
	require.NoError(t, err)
	assert.Equal(t, "notes", card.Name)
	assert.Equal(t, 5, card.SizeBytes)

	assert.ElementsMatch(t, []string{"uid-notes", "uid-log"}, mgr.UIDs())
}

func TestManager_Restore_HydratesFromMirrorOnColdStart(t *testing.T) {
	// Empty local dir + mirror configured: pull accumulated content from the
	// mirror, which wins over the declared seed.
	sync := &stubMemorySync{hydrate: []workflow.MemoryFile{mf("uid-notes", "notes", "remote content")}}
	mgr := NewManager(t.TempDir(), sync)
	require.NoError(t, mgr.Restore(context.Background(), []workflow.MemoryFile{mf("uid-notes", "notes", "declared seed")}))

	got, err := mgr.Read("uid-notes")
	require.NoError(t, err)
	assert.Equal(t, "remote content", got)
	assert.Equal(t, 1, sync.hydrateCalls)
}

func TestManager_Restore_LocalWinsAndSkipsHydrate(t *testing.T) {
	// Warm volume: a local record exists, so edge-primary keeps it and the
	// mirror is never consulted — even though both declared and mirror differ.
	dir := t.TempDir()
	writeLocalRecord(t, dir, mf("uid-notes", "notes", "kept local edits"))
	sync := &stubMemorySync{hydrate: []workflow.MemoryFile{mf("uid-notes", "notes", "remote content")}}

	mgr := NewManager(dir, sync)
	require.NoError(t, mgr.Restore(context.Background(), []workflow.MemoryFile{mf("uid-notes", "notes", "declared seed")}))

	got, err := mgr.Read("uid-notes")
	require.NoError(t, err)
	assert.Equal(t, "kept local edits", got)
	assert.Equal(t, 0, sync.hydrateCalls, "local present → mirror must not be hydrated")
}

func TestManager_Restore_DeclaredMetadataIsAuthoritative(t *testing.T) {
	// A rename changes the declared label; local keeps the content. The new
	// label wins, the old content is preserved.
	dir := t.TempDir()
	writeLocalRecord(t, dir, mf("uid-notes", "old-name", "content"))

	mgr := NewManager(dir, nil)
	require.NoError(t, mgr.Restore(context.Background(), []workflow.MemoryFile{mf("uid-notes", "new-name", "ignored seed")}))

	card, err := mgr.Card("uid-notes")
	require.NoError(t, err)
	assert.Equal(t, "new-name", card.Name)
	got, _ := mgr.Read("uid-notes")
	assert.Equal(t, "content", got)
}

func TestManager_Append_PushesToMirror(t *testing.T) {
	sync := &stubMemorySync{}
	mgr := NewManager(t.TempDir(), sync)
	require.NoError(t, mgr.Restore(context.Background(), []workflow.MemoryFile{mf("uid-log", "log", "first line\n")}))

	require.NoError(t, mgr.Append(context.Background(), "uid-log", "second line\n"))
	got, err := mgr.Read("uid-log")
	require.NoError(t, err)
	assert.Equal(t, "first line\nsecond line\n", got)
	require.Len(t, sync.pushes, 1)
	assert.Equal(t, "uid-log", sync.pushes[0].uid)
	assert.Equal(t, "first line\nsecond line\n", sync.pushes[0].content)
}

func TestManager_Append_NoMirror(t *testing.T) {
	mgr := NewManager(t.TempDir(), nil)
	require.NoError(t, mgr.Restore(context.Background(), []workflow.MemoryFile{mf("uid-log", "log", "a")}))

	require.NoError(t, mgr.Append(context.Background(), "uid-log", "b"))
	got, _ := mgr.Read("uid-log")
	assert.Equal(t, "ab", got)
}

func TestManager_Append_MirrorFailureIsBestEffort(t *testing.T) {
	// A mirror push failure must not fail the agent's local write: local is
	// the source of truth, the remote is a best-effort mirror.
	sync := &stubMemorySync{pushErr: errors.New("mirror unreachable")}
	mgr := NewManager(t.TempDir(), sync)
	require.NoError(t, mgr.Restore(context.Background(), []workflow.MemoryFile{mf("uid-notes", "notes", "x")}))

	require.NoError(t, mgr.Append(context.Background(), "uid-notes", "y"))
	got, _ := mgr.Read("uid-notes")
	assert.Equal(t, "xy", got, "local write must commit despite a failed mirror push")
}

func TestManager_Edit_FoundAndMissing(t *testing.T) {
	mgr := NewManager(t.TempDir(), nil)
	require.NoError(t, mgr.Restore(context.Background(), []workflow.MemoryFile{mf("uid-notes", "notes", "prefers tea")}))

	require.NoError(t, mgr.Edit(context.Background(), "uid-notes", "tea", "coffee"))
	got, _ := mgr.Read("uid-notes")
	assert.Equal(t, "prefers coffee", got)

	err := mgr.Edit(context.Background(), "uid-notes", "nonexistent", "x")
	assert.ErrorIs(t, err, ErrEditNoMatch)
}

func TestManager_Append_SizeCap(t *testing.T) {
	max := 5
	sync := &stubMemorySync{}
	mgr := NewManager(t.TempDir(), sync)
	declared := []workflow.MemoryFile{{Id: "uid-tiny", Label: "tiny", Description: "n", Content: "abc", MaxSizeBytes: &max}}
	require.NoError(t, mgr.Restore(context.Background(), declared))

	err := mgr.Append(context.Background(), "uid-tiny", "xyz") // "abcxyz" (6 > 5)
	assert.ErrorIs(t, err, ErrSizeExceeded)

	got, _ := mgr.Read("uid-tiny")
	assert.Equal(t, "abc", got, "failed write must not mutate state")
	assert.Empty(t, sync.pushes, "size-capped write must not push to mirror")
}

func TestManager_UnknownFile(t *testing.T) {
	mgr := NewManager(t.TempDir(), nil)
	require.NoError(t, mgr.Restore(context.Background(), nil))

	_, err := mgr.Read("uid-missing")
	assert.ErrorIs(t, err, ErrFileNotFound)
	assert.ErrorIs(t, mgr.Append(context.Background(), "uid-missing", "x"), ErrFileNotFound)
	assert.ErrorIs(t, mgr.Edit(context.Background(), "uid-missing", "a", "b"), ErrFileNotFound)
}
