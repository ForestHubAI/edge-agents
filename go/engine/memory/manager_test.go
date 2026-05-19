package memory

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/ForestHubAI/fh-core/go/api/workflow"

	"github.com/ForestHubAI/fh-core/go/engine/backend"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// snapshot helper: serve a static memory snapshot.
func snapshotServer(t *testing.T, snapshot []workflow.MemoryFile) (*httptest.Server, *int32) {
	t.Helper()
	var puts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/agents/memory":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(snapshot)
		case r.Method == http.MethodPut && strings.HasPrefix(r.URL.Path, "/agents/memory/"):
			atomic.AddInt32(&puts, 1)
			_, _ = io.Copy(io.Discard, r.Body)
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Logf("unexpected %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	return srv, &puts
}

func TestManager_RestoreAndRead(t *testing.T) {
	max := 2048
	srv, _ := snapshotServer(t, []workflow.MemoryFile{
		{UID: "uid-notes", Name: "notes", Description: "scratch pad", Content: "hello", MaxSizeBytes: &max},
		{UID: "uid-log", Name: "log", Description: "session log", Content: ""},
	})
	defer srv.Close()

	mgr := NewManager(t.TempDir(), backend.NewClient(srv.URL, "secret"))
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

func TestManager_Append_PushesToBackend(t *testing.T) {
	srv, puts := snapshotServer(t, []workflow.MemoryFile{
		{UID: "uid-log", Name: "log", Description: "log file", Content: "first line\n"},
	})
	defer srv.Close()

	mgr := NewManager(t.TempDir(), backend.NewClient(srv.URL, "secret"))
	require.NoError(t, mgr.Restore(context.Background()))

	require.NoError(t, mgr.Append(context.Background(), "uid-log", "second line\n"))
	got, err := mgr.Read("uid-log")
	require.NoError(t, err)
	assert.Equal(t, "first line\nsecond line\n", got)
	assert.Equal(t, int32(1), atomic.LoadInt32(puts))
}

func TestManager_Edit_FoundAndMissing(t *testing.T) {
	srv, _ := snapshotServer(t, []workflow.MemoryFile{
		{UID: "uid-notes", Name: "notes", Description: "n", Content: "prefers tea"},
	})
	defer srv.Close()

	mgr := NewManager(t.TempDir(), backend.NewClient(srv.URL, "secret"))
	require.NoError(t, mgr.Restore(context.Background()))

	require.NoError(t, mgr.Edit(context.Background(), "uid-notes", "tea", "coffee"))
	got, _ := mgr.Read("uid-notes")
	assert.Equal(t, "prefers coffee", got)

	err := mgr.Edit(context.Background(), "uid-notes", "nonexistent", "x")
	assert.ErrorIs(t, err, ErrEditNoMatch)
}

func TestManager_Append_SizeCap(t *testing.T) {
	max := 5
	srv, _ := snapshotServer(t, []workflow.MemoryFile{
		{UID: "uid-tiny", Name: "tiny", Description: "n", Content: "abc", MaxSizeBytes: &max},
	})
	defer srv.Close()

	mgr := NewManager(t.TempDir(), backend.NewClient(srv.URL, "secret"))
	require.NoError(t, mgr.Restore(context.Background()))

	err := mgr.Append(context.Background(), "uid-tiny", "xyz") // "abcxyz" (6 > 5)
	assert.ErrorIs(t, err, ErrSizeExceeded)

	got, _ := mgr.Read("uid-tiny")
	assert.Equal(t, "abc", got, "failed write must not mutate state")
}

func TestManager_UnknownFile(t *testing.T) {
	srv, _ := snapshotServer(t, nil)
	defer srv.Close()

	mgr := NewManager(t.TempDir(), backend.NewClient(srv.URL, "secret"))
	require.NoError(t, mgr.Restore(context.Background()))

	_, err := mgr.Read("uid-missing")
	assert.ErrorIs(t, err, ErrFileNotFound)
	assert.ErrorIs(t, mgr.Append(context.Background(), "uid-missing", "x"), ErrFileNotFound)
	assert.ErrorIs(t, mgr.Edit(context.Background(), "uid-missing", "a", "b"), ErrFileNotFound)
}

func TestManager_NoBackend_Restore(t *testing.T) {
	mgr := NewManager(t.TempDir(), nil)
	require.NoError(t, mgr.Restore(context.Background()))
	assert.Empty(t, mgr.UIDs())
}

func TestManager_BackendDown_AppendFails(t *testing.T) {
	srv, _ := snapshotServer(t, []workflow.MemoryFile{
		{UID: "uid-notes", Name: "notes", Description: "n", Content: "x"},
	})
	mgr := NewManager(t.TempDir(), backend.NewClient(srv.URL, "secret"))
	require.NoError(t, mgr.Restore(context.Background()))
	srv.Close()

	err := mgr.Append(context.Background(), "uid-notes", "y")
	assert.Error(t, err)
	got, _ := mgr.Read("uid-notes")
	assert.Equal(t, "x", got, "failed push must not commit in-memory state")
}
