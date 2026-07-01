package build

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/textproto"

	"github.com/ForestHubAI/edge-agents/go/api/mlinferenceapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
)

// mlEndpoint is the HTTP adapter for one declared ML model: it implements
// engine.MLInferenceClient over the generated sidecar client, binding the model
// name so callers pass only the input.
type mlEndpoint struct {
	client    *mlinferenceapi.ClientWithResponses
	modelName string
}

var _ engine.MLInferenceClient = (*mlEndpoint)(nil)

// Infer sends the tensors to the sidecar as a multipart /infer request and
// returns the handler-produced result object.
func (e *mlEndpoint) Infer(ctx context.Context, tensors map[string]any) (map[string]any, error) {
	contentType, body, err := buildTensorsBody(e.modelName, tensors)
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	resp, err := e.client.InferWithBodyWithResponse(ctx, contentType, body)
	if err != nil {
		return nil, fmt.Errorf("calling sidecar: %w", err)
	}
	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("sidecar returned %d: %s", resp.StatusCode(), inferErrorMessage(resp))
	}
	if resp.JSON200 == nil {
		return nil, fmt.Errorf("sidecar returned 200 with no result body")
	}
	return resp.JSON200.Result, nil
}

// buildTensorsBody assembles the /infer multipart body: the model selector plus
// the tensors object as a JSON part, matching the contract's encoding.
func buildTensorsBody(modelName string, tensors map[string]any) (string, *bytes.Buffer, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if err := w.WriteField("model", modelName); err != nil {
		return "", nil, err
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="tensors"`)
	header.Set("Content-Type", "application/json")
	part, err := w.CreatePart(header)
	if err != nil {
		return "", nil, err
	}
	if err := json.NewEncoder(part).Encode(tensors); err != nil {
		return "", nil, err
	}
	if err := w.Close(); err != nil {
		return "", nil, err
	}
	return w.FormDataContentType(), &buf, nil
}

// inferErrorMessage extracts the sidecar's error message from a non-2xx
// response, falling back to the HTTP status text.
func inferErrorMessage(resp *mlinferenceapi.InferResponse) string {
	switch {
	case resp.JSON404 != nil:
		return resp.JSON404.Message
	case resp.JSON422 != nil:
		return resp.JSON422.Message
	default:
		return resp.Status()
	}
}

// buildDeployML resolves a workflow's declared ML models into per-model inference
// endpoints. wf.Models also holds LLM models (resolved separately in
// buildDeployProviders); those are skipped here by discriminator. An unbound or
// unconfigured ML model is a deploy error. Many models may resolve to the same
// sidecar url — expected, since one sidecar serves a repository of models and the
// model name is sent per request. No network call is made here.
func buildDeployML(wf *workflow.Workflow, dm engine.DeploymentMapping, ext *engine.ExternalResources) (map[string]*mlEndpoint, error) {
	endpoints := make(map[string]*mlEndpoint)
	for _, mu := range wf.Models {
		disc, err := mu.Discriminator()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		if disc != string(workflow.MLModelTypeMLModel) {
			continue
		}
		m, err := mu.AsMLModel()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		b, ok := dm[m.Id]
		if !ok || b.Ref == "" {
			return nil, fmt.Errorf("model %q: declared but not bound by the deployment mapping", m.Id)
		}
		var cfg engine.MLInferenceConfig
		if ext != nil {
			cfg, ok = ext.MLInference[b.Ref]
		}
		if !ok {
			return nil, fmt.Errorf("model %q: bound to %q but no ml inference config in deploy externalResources", m.Id, b.Ref)
		}
		client, err := mlinferenceapi.NewClientWithResponses(cfg.URL)
		if err != nil {
			return nil, fmt.Errorf("model %q: building inference client: %w", m.Id, err)
		}
		endpoints[m.Id] = &mlEndpoint{client: client, modelName: m.Id}
	}
	return endpoints, nil
}
