package backend

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sampleManifest() *engine.DeviceManifest {
	return &engine.DeviceManifest{
		GPIOs: map[string]engine.GPIOConfig{"led": {Chip: "gpiochip0"}},
	}
}

func TestRegister_Online_Success(t *testing.T) {
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
	require.NoError(t, c.Register(context.Background(), engine.AgentRegistration{
		Address:  "http://engine:8081",
		Status:   engine.StatusOnline,
		Manifest: sampleManifest(),
	}))
	assert.Equal(t, "/agents/bootCallback", gotPath)
	assert.Equal(t, "secret", gotKey)
	assert.JSONEq(t, `{"address":"http://engine:8081","status":"online","loadedDeviceManifest":{"gpios":{"led":{"chip":"gpiochip0"}}}}`, string(gotBody))
}

func TestRegister_BootError_NoManifest(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	errMsg := "manifest parse failed"
	require.NoError(t, c.Register(context.Background(), engine.AgentRegistration{
		Address: "http://engine:8081",
		Status:  engine.StatusBootError,
		Error:   &errMsg,
	}))
	assert.JSONEq(t, `{"address":"http://engine:8081","status":"booterror","error":"manifest parse failed"}`, string(gotBody))
}

func TestRegister_EmptyAddress_OmitsField(t *testing.T) {
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "secret")
	require.NoError(t, c.Register(context.Background(), engine.AgentRegistration{
		Status:   engine.StatusOnline,
		Manifest: sampleManifest(),
	}))
	assert.JSONEq(t,
		`{"status":"online","loadedDeviceManifest":{"gpios":{"led":{"chip":"gpiochip0"}}}}`,
		string(gotBody),
	)
}

func TestRegister_BackendReturns4xx(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "wrong")
	err := c.Register(context.Background(), engine.AgentRegistration{
		Address:  "http://engine:8081",
		Status:   engine.StatusOnline,
		Manifest: sampleManifest(),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "401")
}

func TestRegister_ConnectRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	srv.Close() // bind address is now closed — connect refused

	c := NewClient(srv.URL, "s")
	err := c.Register(context.Background(), engine.AgentRegistration{
		Address:  "http://engine:8081",
		Status:   engine.StatusOnline,
		Manifest: sampleManifest(),
	})
	require.Error(t, err)
}
