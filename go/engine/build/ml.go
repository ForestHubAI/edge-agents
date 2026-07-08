package build

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/mlinferenceapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
)

// mlClientTimeout bounds a single inference call. Inference can be heavy, so the
// budget is generous, but it still frees the node if the sidecar becomes
// unreachable or wedged rather than blocking the runner indefinitely.
const mlClientTimeout = 120 * time.Second

// mlEndpoint is the HTTP adapter for one declared ML model: it implements
// engine.MLInferenceClient over the generated sidecar client, binding the model
// name so callers pass only the input.
type mlEndpoint struct {
	client    *mlinferenceapi.ClientWithResponses
	modelName string
}

var _ engine.MLInferenceClient = (*mlEndpoint)(nil)

// InferTensors sends the tensors to the sidecar as a multipart /infer request
// and returns the handler-produced result object.
func (e *mlEndpoint) InferTensors(ctx context.Context, tensors map[string]any) (map[string]any, error) {
	contentType, body, err := buildTensorsBody(e.modelName, tensors)
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	return e.infer(ctx, contentType, body)
}

// InferBinary sends an opaque binary blob (e.g. an encoded image) to the sidecar
// as a multipart /infer request and returns the handler-produced result object.
func (e *mlEndpoint) InferBinary(ctx context.Context, data []byte) (map[string]any, error) {
	contentType, body, err := buildBinaryBody(e.modelName, data)
	if err != nil {
		return nil, fmt.Errorf("building request: %w", err)
	}
	return e.infer(ctx, contentType, body)
}

// infer posts an already-encoded multipart body to the sidecar and unwraps the
// result, shared by the tensors and binary arms.
func (e *mlEndpoint) infer(ctx context.Context, contentType string, body *bytes.Buffer) (map[string]any, error) {
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

// buildBinaryBody assembles the /infer multipart body: the model selector plus
// the blob as a file part named "binary", matching the contract's encoding. The
// filename is arbitrary but required — it is what makes the part a file upload.
func buildBinaryBody(modelName string, data []byte) (string, *bytes.Buffer, error) {
	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	if err := w.WriteField("model", modelName); err != nil {
		return "", nil, err
	}
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", `form-data; name="binary"; filename="frame"`)
	header.Set("Content-Type", "application/octet-stream")
	part, err := w.CreatePart(header)
	if err != nil {
		return "", nil, err
	}
	if _, err := part.Write(data); err != nil {
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
	case resp.JSON413 != nil:
		return resp.JSON413.Message
	case resp.JSON422 != nil:
		return resp.JSON422.Message
	case resp.JSON500 != nil:
		return resp.JSON500.Message
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
		client, err := mlinferenceapi.NewClientWithResponses(cfg.URL, mlinferenceapi.WithHTTPClient(&http.Client{Timeout: mlClientTimeout}))
		if err != nil {
			return nil, fmt.Errorf("model %q: building inference client: %w", m.Id, err)
		}
		endpoints[m.Id] = &mlEndpoint{client: client, modelName: cfg.Model}
	}
	return endpoints, nil
}
