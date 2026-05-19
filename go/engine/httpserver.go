package engine

import (
	"context"
	"net/http"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/engine/logging"

	strictnethttp "github.com/oapi-codegen/runtime/strictmiddleware/nethttp"
)

// strictServer adapts *Engine to the oapi-codegen-generated
// api.StrictServerInterface. It is a thin shim: every method delegates to
// the Engine's lifecycle methods and maps the result onto a typed response.
type strictServer struct{ engine *Engine }

// NewStrictServer returns the engine's api.StrictServerInterface
// implementation, ready to hand to api.NewStrictHandler.
func NewStrictServer(e *Engine) api.StrictServerInterface { return &strictServer{engine: e} }

// Healthz reports the engine's runtime state.
func (s *strictServer) Healthz(_ context.Context, _ api.HealthzRequestObject) (api.HealthzResponseObject, error) {
	return api.Healthz200JSONResponse{Status: s.engine.Status()}, nil
}

// Deploy deploys (or hot-swaps) a workflow. A nil workflow is a 400; a build
// failure is a 422 — same semantics the hand-written handler had.
func (s *strictServer) Deploy(_ context.Context, request api.DeployRequestObject) (api.DeployResponseObject, error) {
	if request.Body == nil || request.Body.Workflow == nil {
		return api.Deploy400JSONResponse{Error: "workflow required"}, nil
	}
	if err := s.engine.Deploy(request.Body.Workflow, request.Body.NetworkManifest); err != nil {
		return api.Deploy422JSONResponse{Error: "deploy failed: " + err.Error()}, nil
	}
	mqttCount := 0
	if request.Body.NetworkManifest != nil {
		mqttCount = len(request.Body.NetworkManifest.MQTTs)
	}
	logging.Logger.Info().Int("mqtt", mqttCount).Msg("workflow deployed")
	return api.Deploy204Response{}, nil
}

// Stop tears down the running workflow. Idempotent when idle.
func (s *strictServer) Stop(_ context.Context, _ api.StopRequestObject) (api.StopResponseObject, error) {
	s.engine.Stop()
	logging.Logger.Info().Msg("runner stopped")
	return api.Stop204Response{}, nil
}

// AuthMiddleware is a strict-handler middleware enforcing the shared agent
// secret as a bearer token on every operation. An empty configured secret
// rejects all requests, matching the previous per-handler authorize() check.
func AuthMiddleware(secret string) strictnethttp.StrictHTTPMiddlewareFunc {
	return func(f strictnethttp.StrictHTTPHandlerFunc, _ string) strictnethttp.StrictHTTPHandlerFunc {
		return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request interface{}) (interface{}, error) {
			if secret == "" || r.Header.Get("Authorization") != "Bearer "+secret {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return nil, nil
			}
			return f(ctx, w, r, request)
		}
	}
}
