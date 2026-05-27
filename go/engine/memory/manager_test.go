package memory

import (
	"context"
	"errors"
	"testing"

	"github.com/ForestHubAI/fh-core/go/api/workflow"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubMemoryStore is a hand-rolled engine.MemoryStore for exercising the
// Manager without an HTTP adapter. Snapshot returns the configured slice;
// Upsert records each call and optionally fails with upsertErr.
type stubMemoryStore struct {
	snapshot  []workflow.MemoryFile
	upserts   []memoryUpsert
	upsertErr error
}

type memoryUpsert struct {
	uid     string
	content string
}

func (s *stubMemoryStore) Snapshot(_ context.Context) ([]workflow.MemoryFile, error) {
	return s.snapshot, nil
}

func (s *stubMemoryStore) Upsert(_ context.Context, uid, content string) error {
	if s.upsertErr != nil {
		return s.upsertErr
	}
	s.upserts = append(s.upserts, memoryUpsert{uid: uid, content: content})
	return nil
}

func TestManager_RestoreAndRead(t *testing.T) {
	max := 2048
	store := &stubMemoryStore{snapshot: []workflow.MemoryFile{
		{Id: "uid-notes", Label: "notes", Description: "scratch pad", Content: "hello", MaxSizeBytes: &max},
		{Id: "uid-log", Label: "log", Description: "session log", Content: ""},
	}}

	mgr := NewManager(t.TempDir(), store)
	require.NoError(t, mgr.Restore(context.Background()))

	got, err := mgr.Read("uid-notes")
	require.NoError(t, err)
	assert.Equal(t, "hello", got)

	card, err := mgr.Card("uid-notes")
	require.NoError(t, err)
	assert.Equal(t, "notes", card.Name)
	assert.Equal(t, "scratch pad", card.Description)
	assert.Equal(t, 5, card.SizeBytes)

	uids := mgr.UIDs()
	assert.ElementsMatch(t, []string{"uid-notes", "uid-log"}, uids)
}

func TestManager_Append_PushesToStore(t *testing.T) {
	store := &stubMemoryStore{snapshot: []workflow.MemoryFile{
		{Id: "uid-log", Label: "log", Description: "log file", Content: "first line\n"},
	}}

	mgr := NewManager(t.TempDir(), store)
	require.NoError(t, mgr.Restore(context.Background()))

	require.NoError(t, mgr.Append(context.Background(), "uid-log", "second line\n"))
	got, err := mgr.Read("uid-log")
	require.NoError(t, err)
	assert.Equal(t, "first line\nsecond line\n", got)
	require.Len(t, store.upserts, 1)
	assert.Equal(t, "uid-log", store.upserts[0].uid)
	assert.Equal(t, "first line\nsecond line\n", store.upserts[0].content)
}

func TestManager_Edit_FoundAndMissing(t *testing.T) {
	store := &stubMemoryStore{snapshot: []workflow.MemoryFile{
		{Id: "uid-notes", Label: "notes", Description: "n", Content: "prefers tea"},
	}}

	mgr := NewManager(t.TempDir(), store)
	require.NoError(t, mgr.Restore(context.Background()))

	require.NoError(t, mgr.Edit(context.Background(), "uid-notes", "tea", "coffee"))
	got, _ := mgr.Read("uid-notes")
	assert.Equal(t, "prefers coffee", got)

	err := mgr.Edit(context.Background(), "uid-notes", "nonexistent", "x")
	assert.ErrorIs(t, err, ErrEditNoMatch)
}

func TestManager_Append_SizeCap(t *testing.T) {
	max := 5
	store := &stubMemoryStore{snapshot: []workflow.MemoryFile{
		{Id: "uid-tiny", Label: "tiny", Description: "n", Content: "abc", MaxSizeBytes: &max},
	}}

	mgr := NewManager(t.TempDir(), store)
	require.NoError(t, mgr.Restore(context.Background()))

	err := mgr.Append(context.Background(), "uid-tiny", "xyz") // "abcxyz" (6 > 5)
	assert.ErrorIs(t, err, ErrSizeExceeded)

	got, _ := mgr.Read("uid-tiny")
	assert.Equal(t, "abc", got, "failed write must not mutate state")
	assert.Empty(t, store.upserts, "size-capped write must not push to store")
}

func TestManager_UnknownFile(t *testing.T) {
	mgr := NewManager(t.TempDir(), &stubMemoryStore{})
	require.NoError(t, mgr.Restore(context.Background()))

	_, err := mgr.Read("uid-missing")
	assert.ErrorIs(t, err, ErrFileNotFound)
	assert.ErrorIs(t, mgr.Append(context.Background(), "uid-missing", "x"), ErrFileNotFound)
	assert.ErrorIs(t, mgr.Edit(context.Background(), "uid-missing", "a", "b"), ErrFileNotFound)
}

func TestManager_NoStore_Restore(t *testing.T) {
	mgr := NewManager(t.TempDir(), nil)
	require.NoError(t, mgr.Restore(context.Background()))
	assert.Empty(t, mgr.UIDs())
}

func TestManager_StoreFails_AppendFails(t *testing.T) {
	store := &stubMemoryStore{
		snapshot: []workflow.MemoryFile{
			{Id: "uid-notes", Label: "notes", Description: "n", Content: "x"},
		},
	}
	mgr := NewManager(t.TempDir(), store)
	require.NoError(t, mgr.Restore(context.Background()))
	store.upsertErr = errors.New("store unreachable")

	err := mgr.Append(context.Background(), "uid-notes", "y")
	require.Error(t, err)
	got, _ := mgr.Read("uid-notes")
	assert.Equal(t, "x", got, "failed push must not commit in-memory state")
}
