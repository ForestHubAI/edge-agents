package backend

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetProviders_Success(t *testing.T) {
	var (
		gotPath string
		gotKey  string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotKey = r.Header.Get("Agent-Key")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"id":"Anthropic","models":[{"id":"claude-haiku-4-5","label":"Claude Haiku","capabilities":["chat"]}]}]`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	got, err := c.GetProviders(context.Background())
	require.NoError(t, err)
	assert.Equal(t, "/llm/catalog", gotPath)
	assert.Equal(t, "secret", gotKey)
	require.Len(t, got, 1)
	assert.Equal(t, "Anthropic", string(got[0].ID))
	require.Len(t, got[0].Models, 1)
	assert.Equal(t, "claude-haiku-4-5", string(got[0].Models[0].ID))
}

func TestGetProviders_BackendReturns4xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "wrong")
	_, err := c.GetProviders(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "401")
}

func TestHealth_Success(t *testing.T) {
	var (
		gotPath string
		gotKey  string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotKey = r.Header.Get("Agent-Key")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`"ok"`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	require.NoError(t, c.Health(context.Background()))
	assert.Equal(t, "/llm/health", gotPath)
	assert.Equal(t, "secret", gotKey)
}

func TestHealth_BackendError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	err := c.Health(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "503")
}

func TestChat_Success(t *testing.T) {
	var (
		gotPath   string
		gotMethod string
		gotBody   map[string]any
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotMethod = r.Method
		body, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(body, &gotBody)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"hello back","responseID":"resp-1","tokensUsed":42}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	resp, err := c.Chat(context.Background(), &llmproxy.ChatRequest{
		Model:        "claude-haiku-4-5",
		Input:        llmproxy.InputString("hello"),
		SystemPrompt: "be brief",
	})
	require.NoError(t, err)
	assert.Equal(t, "/llm/generate", gotPath)
	assert.Equal(t, http.MethodPost, gotMethod)
	assert.Equal(t, "claude-haiku-4-5", gotBody["model"])
	assert.Equal(t, "be brief", gotBody["systemPrompt"])
	assert.Equal(t, "hello back", resp.Text)
	assert.Equal(t, "resp-1", resp.ResponseID)
	assert.Equal(t, 42, resp.TokensUsed)
}

func TestChat_BackendError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	_, err := c.Chat(context.Background(), &llmproxy.ChatRequest{
		Model: "claude-haiku-4-5",
		Input: llmproxy.InputString("hi"),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "500")
}

// TestBackendProvider_UploadDeleteReturnNotSupported guards the deliberate
// non-implementation of file-related provider methods: the backend wire
// protocol for multipart proxying does not exist, so callers must see a
// stable provider.ErrNotSupported instead of a confusing transport error.
func TestBackendProvider_UploadDeleteReturnNotSupported(t *testing.T) {
	c := NewClient("http://unused", "secret")
	p := NewBackendProvider(c, "Anthropic", nil)

	_, uploadErr := p.UploadFile(context.Background(), &llmproxy.FileUploadRequest{})
	require.Error(t, uploadErr)
	assert.True(t, errors.Is(uploadErr, provider.ErrNotSupported))

	_, deleteErr := p.DeleteFile(context.Background(), "file-id")
	require.Error(t, deleteErr)
	assert.True(t, errors.Is(deleteErr, provider.ErrNotSupported))
}
