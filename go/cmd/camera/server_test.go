package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/captureapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTestHandler() http.Handler {
	sources := map[string]source{"cam": debugSource{}}
	return captureapi.HandlerFromMux(newServer(sources), http.NewServeMux())
}

func do(t *testing.T, target string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	newTestHandler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
	return rec
}

func TestCapture_DebugJPEG(t *testing.T) {
	rec := do(t, "/capture?name=cam")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "image/jpeg", rec.Header().Get("Content-Type"))
	require.GreaterOrEqual(t, rec.Body.Len(), 2)
	assert.Equal(t, []byte{0xFF, 0xD8}, rec.Body.Bytes()[:2])
}

func TestCapture_UnknownName(t *testing.T) {
	rec := do(t, "/capture?name=nope")
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestHealthz(t *testing.T) {
	assert.Equal(t, http.StatusOK, do(t, "/healthz").Code)
}

func TestReadyz(t *testing.T) {
	assert.Equal(t, http.StatusOK, do(t, "/readyz").Code)
}

func TestMetadata_ListsNames(t *testing.T) {
	rec := do(t, "/metadata")
	require.Equal(t, http.StatusOK, rec.Code)

	var md captureapi.CaptureMetadata
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &md))
	require.Len(t, md.Devices, 1)
	assert.Equal(t, "cam", md.Devices[0].Name)
}
