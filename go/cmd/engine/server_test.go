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
