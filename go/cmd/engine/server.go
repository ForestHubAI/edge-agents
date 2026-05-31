package main

import (
	"context"
	"crypto/subtle"
	"net/http"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/ForestHubAI/edge-agents/go/mapping"
)

// strictServer adapts *engine.Engine to the oapi-codegen-generated SSI.
type strictServer struct{ engine *engine.Engine }

// NewStrictServer returns the engine's engineapi.StrictServerInterface
// implementation, ready to hand to engineapi.NewStrictHandler.
func NewStrictServer(e *engine.Engine) engineapi.StrictServerInterface {
	return &strictServer{engine: e}
}

// Healthz reports the engine's runtime state.
func (s *strictServer) Healthz(_ context.Context, _ engineapi.HealthzRequestObject) (engineapi.HealthzResponseObject, error) {
	return engineapi.Healthz200JSONResponse{Status: mapping.StatusToAPI(s.engine.IsRunning())}, nil
}

// Deploy deploys (or hot-swaps) a workflow. A nil workflow is a 400; a build
// failure is a 422.
func (s *strictServer) Deploy(_ context.Context, request engineapi.DeployRequestObject) (engineapi.DeployResponseObject, error) {
	if request.Body == nil || request.Body.Workflow == nil {
		return engineapi.Deploy400JSONResponse{Error: "workflow required"}, nil
	}
	if err := s.engine.Deploy(request.Body.Workflow, mapping.DeploymentMappingToDomain(request.Body.Mapping), mapping.ExternalResourcesToDomain(request.Body.ExternalResources)); err != nil {
		return engineapi.Deploy422JSONResponse{Error: "deploy failed: " + err.Error()}, nil
	}
	resourceCount := 0
	if request.Body.ExternalResources != nil {
		resourceCount = len(*request.Body.ExternalResources)
	}
	logging.Logger.Info().Int("externalResources", resourceCount).Msg("workflow deployed")
	return engineapi.Deploy204Response{}, nil
}

// Stop tears down the running workflow. Idempotent when idle.
func (s *strictServer) Stop(_ context.Context, _ engineapi.StopRequestObject) (engineapi.StopResponseObject, error) {
	s.engine.Stop()
	logging.Logger.Info().Msg("runner stopped")
	return engineapi.Stop204Response{}, nil
}

// AuthMiddleware is a strict-handler middleware enforcing the shared agent
// secret as a bearer token on every operation. An empty configured secret
// rejects all requests. The token comparison uses crypto/subtle to avoid
// leaking the secret through response-time side channels.
func AuthMiddleware(secret string) engineapi.StrictMiddlewareFunc {
	want := []byte("Bearer " + secret)
	return func(f engineapi.StrictHandlerFunc, _ string) engineapi.StrictHandlerFunc {
		return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request interface{}) (interface{}, error) {
			got := []byte(r.Header.Get("Authorization"))
			// Length differs => unauthorized. Length is not secret, so an
			// early return here does not weaken the constant-time check;
			// ConstantTimeCompare itself rejects unequal-length inputs.
			if secret == "" || len(got) != len(want) || subtle.ConstantTimeCompare(got, want) != 1 {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return nil, nil
			}
			return f(ctx, w, r, request)
		}
	}
}
