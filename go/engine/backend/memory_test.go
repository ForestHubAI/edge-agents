package backend

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHydrate_Success(t *testing.T) {
	var (
		gotKey    string
		gotMethod string
		gotPath   string
	)
	max := 2048
	want := []workflow.MemoryFile{
		{Id: "uid-notes", Label: "notes", Description: "scratch", Content: "hello", MaxSizeBytes: &max},
		{Id: "uid-log", Label: "log", Description: "session", Content: ""},
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotKey = r.Header.Get("Agent-Key")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(want)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	got, err := c.Hydrate(context.Background())
	require.NoError(t, err)
	assert.Equal(t, http.MethodGet, gotMethod)
	assert.Equal(t, "/agents/memory", gotPath)
	assert.Equal(t, "secret", gotKey)
	require.Len(t, got, 2)
	assert.Equal(t, "uid-notes", got[0].Id)
	assert.Equal(t, "hello", got[0].Content)
	assert.Equal(t, "uid-log", got[1].Id)
}

func TestHydrate_BackendError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	_, err := c.Hydrate(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}

func TestPush_Success(t *testing.T) {
	var (
		gotKey    string
		gotMethod string
		gotPath   string
		gotBody   []byte
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotKey = r.Header.Get("Agent-Key")
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	require.NoError(t, c.Push(context.Background(), "uid-notes", "hello world"))
	assert.Equal(t, http.MethodPut, gotMethod)
	assert.Equal(t, "/agents/memory/uid-notes", gotPath)
	assert.Equal(t, "secret", gotKey)
	assert.JSONEq(t, `{"content":"hello world"}`, string(gotBody))
}

func TestPush_BackendError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	err := c.Push(context.Background(), "uid-missing", "x")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "404")
}
