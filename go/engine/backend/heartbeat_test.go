package backend

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

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

func TestHeartbeatLoop_TickAndCancel(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	orig := heartbeatInterval
	heartbeatInterval = 20 * time.Millisecond
	defer func() { heartbeatInterval = orig }()

	ctx, cancel := context.WithCancel(context.Background())
	c := NewClient(srv.URL, "s")
	done := make(chan struct{})
	go func() {
		c.HeartbeatLoop(ctx, "http://engine:8081")
		close(done)
	}()

	time.Sleep(80 * time.Millisecond)
	cancel()

	select {
	case <-done:
		assert.GreaterOrEqual(t, atomic.LoadInt32(&calls), int32(2))
	case <-time.After(2 * time.Second):
		t.Fatal("HeartbeatLoop did not exit after context cancel")
	}
}

func TestHeartbeatLoop_HTTPFailureContinues(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n < 3 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	orig := heartbeatInterval
	heartbeatInterval = 20 * time.Millisecond
	defer func() { heartbeatInterval = orig }()

	ctx, cancel := context.WithCancel(context.Background())
	c := NewClient(srv.URL, "s")
	go c.HeartbeatLoop(ctx, "http://engine:8081")

	time.Sleep(120 * time.Millisecond)
	cancel()

	assert.GreaterOrEqual(t, atomic.LoadInt32(&calls), int32(4))
}
