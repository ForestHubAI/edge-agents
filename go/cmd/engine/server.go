package main

import (
	"context"
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

// Status reports the engine's runtime state.
func (s *strictServer) Status(_ context.Context, _ engineapi.StatusRequestObject) (engineapi.StatusResponseObject, error) {
	return engineapi.Status200JSONResponse{Status: mapping.StatusToAPI(s.engine.IsRunning())}, nil
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
// rejects all requests.
func AuthMiddleware(secret string) engineapi.StrictMiddlewareFunc {
	return func(f engineapi.StrictHandlerFunc, _ string) engineapi.StrictHandlerFunc {
		return func(ctx context.Context, w http.ResponseWriter, r *http.Request, request interface{}) (interface{}, error) {
			if secret == "" || r.Header.Get("Authorization") != "Bearer "+secret {
				http.Error(w, "unauthorized", http.StatusUnauthorized)
				return nil, nil
			}
			return f(ctx, w, r, request)
		}
	}
}
