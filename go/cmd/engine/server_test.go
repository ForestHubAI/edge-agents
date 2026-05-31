package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/stretchr/testify/assert"
)

// okHandler is a no-op StrictHandlerFunc used to detect whether the
// AuthMiddleware passed the request through (handler called) or rejected it
// (handler not called, 401 written by the middleware).
func okHandler(called *bool) engineapi.StrictHandlerFunc {
	return func(_ context.Context, w http.ResponseWriter, _ *http.Request, _ interface{}) (interface{}, error) {
		*called = true
		w.WriteHeader(http.StatusOK)
		return nil, nil
	}
}

func TestAuthMiddleware_RejectsBadBearer(t *testing.T) {
	mw := AuthMiddleware("s3cret")
	called := false
	handler := mw(okHandler(&called), "Deploy")

	req := httptest.NewRequest(http.MethodPost, "/deploy", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec := httptest.NewRecorder()

	_, err := handler(req.Context(), rec, req, nil)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called, "downstream handler must not run on bad bearer")
}

func TestAuthMiddleware_RejectsMissingHeader(t *testing.T) {
	mw := AuthMiddleware("s3cret")
	called := false
	handler := mw(okHandler(&called), "Deploy")

	req := httptest.NewRequest(http.MethodPost, "/deploy", nil)
	rec := httptest.NewRecorder()

	_, err := handler(req.Context(), rec, req, nil)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}

func TestAuthMiddleware_RejectsEmptyConfiguredSecret(t *testing.T) {
	mw := AuthMiddleware("")
	called := false
	handler := mw(okHandler(&called), "Deploy")

	req := httptest.NewRequest(http.MethodPost, "/deploy", nil)
	req.Header.Set("Authorization", "Bearer ")
	rec := httptest.NewRecorder()

	_, err := handler(req.Context(), rec, req, nil)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.False(t, called)
}

func TestAuthMiddleware_HealthzBypassesAuth(t *testing.T) {
	mw := AuthMiddleware("s3cret")
	called := false
	// Pass operationID="Healthz" — the middleware must let this through
	// without checking the Authorization header so that container
	// orchestrators can probe readiness without the shared secret.
	handler := mw(okHandler(&called), "Healthz")

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	// Deliberately no Authorization header.
	rec := httptest.NewRecorder()

	_, err := handler(req.Context(), rec, req, nil)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called, "Healthz must reach the downstream handler unauthenticated")
}

func TestAuthMiddleware_HealthzBypassesEvenWithEmptySecret(t *testing.T) {
	// Empty secret normally rejects every request. Healthz must still be
	// reachable so a misconfigured engine can be diagnosed via the probe.
	mw := AuthMiddleware("")
	called := false
	handler := mw(okHandler(&called), "Healthz")

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()

	_, err := handler(req.Context(), rec, req, nil)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}

func TestAuthMiddleware_AcceptsCorrectBearer(t *testing.T) {
	mw := AuthMiddleware("s3cret")
	called := false
	handler := mw(okHandler(&called), "Deploy")

	req := httptest.NewRequest(http.MethodPost, "/deploy", nil)
	req.Header.Set("Authorization", "Bearer s3cret")
	rec := httptest.NewRecorder()

	_, err := handler(req.Context(), rec, req, nil)
	assert.NoError(t, err)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}
