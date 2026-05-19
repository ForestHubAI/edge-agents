package backend

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"fh-backend/pkg/domain"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sampleManifest() *domain.DeviceManifest {
	return &domain.DeviceManifest{
		GPIOs: map[string]domain.GPIOConfig{"led": {Chip: "gpiochip0"}},
	}
}

func TestBootCallback_Online_Success(t *testing.T) {
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
	require.NotNil(t, c)
	require.NoError(t, c.BootCallback(context.Background(), "http://engine:8081", "online", sampleManifest(), nil))
	assert.Equal(t, "/agents/bootCallback", gotPath)
	assert.Equal(t, "secret", gotKey)
	assert.JSONEq(t, `{"address":"http://engine:8081","status":"online","loadedDeviceManifest":{"gpios":{"led":{"chip":"gpiochip0"}},"adcs":null,"dacs":null,"serials":null,"pwms":null}}`, string(gotBody))
}

func TestBootCallback_BootError_NoManifest(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	errMsg := "manifest parse failed"
	require.NoError(t, c.BootCallback(context.Background(), "http://engine:8081", "booterror", nil, &errMsg))
	assert.JSONEq(t, `{"address":"http://engine:8081","status":"booterror","error":"manifest parse failed"}`, string(gotBody))
}

func TestBootCallback_EmptyAddress_OmitsField(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	require.NoError(t, c.BootCallback(context.Background(), "", "online", sampleManifest(), nil))
	assert.JSONEq(t,
		`{"status":"online","loadedDeviceManifest":{"gpios":{"led":{"chip":"gpiochip0"}},"adcs":null,"dacs":null,"serials":null,"pwms":null}}`,
		string(gotBody),
	)
}

func TestBootCallback_BackendReturns4xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "wrong")
	err := c.BootCallback(context.Background(), "http://engine:8081", "online", sampleManifest(), nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "401")
}

func TestBootCallback_ConnectRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // bind address is now closed — connect refused

	c := NewClient(srv.URL, "s")
	err := c.BootCallback(context.Background(), "http://engine:8081", "online", sampleManifest(), nil)
	require.Error(t, err)
}

func TestBootCallbackWithRetry_EventuallySucceeds(t *testing.T) {
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n < 2 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	// Shrink the retry interval for this test via a package-level monkey-patch.
	orig := retryInterval
	retryInterval = 20 * time.Millisecond
	defer func() { retryInterval = orig }()

	c := NewClient(srv.URL, "s")
	done := make(chan struct{})
	go func() {
		c.BootCallbackWithRetry(context.Background(), "http://engine:8081", "online", sampleManifest(), nil)
		close(done)
	}()

	select {
	case <-done:
		assert.GreaterOrEqual(t, atomic.LoadInt32(&attempts), int32(2))
	case <-time.After(2 * time.Second):
		t.Fatal("BootCallbackWithRetry did not return within 2s")
	}
}

func TestBootCallbackWithRetry_RespectsContextCancel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	orig := retryInterval
	retryInterval = 20 * time.Millisecond
	defer func() { retryInterval = orig }()

	ctx, cancel := context.WithCancel(context.Background())
	c := NewClient(srv.URL, "s")
	done := make(chan struct{})
	go func() {
		c.BootCallbackWithRetry(ctx, "http://engine:8081", "online", sampleManifest(), nil)
		close(done)
	}()

	time.Sleep(50 * time.Millisecond)
	cancel()

	select {
	case <-done:
		// ok
	case <-time.After(2 * time.Second):
		t.Fatal("BootCallbackWithRetry did not exit after context cancel")
	}
}
