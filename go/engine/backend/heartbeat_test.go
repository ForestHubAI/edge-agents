package backend

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHeartbeat_Success(t *testing.T) {
	var (
		gotKey  string
		gotBody []byte
		gotPath string
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotKey = r.Header.Get("Agent-Key")
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	require.NoError(t, c.Heartbeat(context.Background(), "http://engine:8081"))
	assert.Equal(t, "/agents/heartbeat", gotPath)
	assert.Equal(t, "secret", gotKey)
	assert.JSONEq(t, `{"address":"http://engine:8081"}`, string(gotBody))
}

func TestHeartbeat_EmptyAddress_OmitsField(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	require.NoError(t, c.Heartbeat(context.Background(), ""))
	assert.JSONEq(t, `{}`, string(gotBody))
}

func TestHeartbeat_BackendReturns4xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "wrong")
	err := c.Heartbeat(context.Background(), "http://engine:8081")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "401")
}
