// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

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

	"github.com/ForestHubAI/edge-agents/go/api/mlapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
)

// mlClientTimeout bounds a single inference call. Inference can be heavy, so the
// budget is generous, but it still frees the node if the component becomes
// unreachable or wedged rather than blocking the runner indefinitely.
const mlClientTimeout = 120 * time.Second

// mlEndpoint is the HTTP adapter for one declared ML model: it implements
// engine.MLClient over the generated component client, binding the model
// name so callers pass only the input.
type mlEndpoint struct {
	client    *mlapi.ClientWithResponses
	modelName string
}

var _ engine.MLClient = (*mlEndpoint)(nil)

// InferTensors sends the tensors to the component as a multipart /infer request
// and returns the model's task-shaped result.
func (e *mlEndpoint) InferTensors(ctx context.Context, tensors map[string]any) (engine.InferenceResult, error) {
	contentType, body, err := buildTensorsBody(e.modelName, tensors)
	if err != nil {
		return engine.InferenceResult{}, fmt.Errorf("building request: %w", err)
	}
	return e.infer(ctx, contentType, body)
}

// InferBinary sends an opaque binary blob (e.g. an encoded image) to the component
// as a multipart /infer request and returns the model's task-shaped result.
func (e *mlEndpoint) InferBinary(ctx context.Context, data []byte) (engine.InferenceResult, error) {
	contentType, body, err := buildBinaryBody(e.modelName, data)
	if err != nil {
		return engine.InferenceResult{}, fmt.Errorf("building request: %w", err)
	}
	return e.infer(ctx, contentType, body)
}

// infer posts an already-encoded multipart body to the component and maps the
// response onto the domain result, shared by the tensors and binary arms.
func (e *mlEndpoint) infer(ctx context.Context, contentType string, body *bytes.Buffer) (engine.InferenceResult, error) {
	resp, err := e.client.InferWithBodyWithResponse(ctx, contentType, body)
	if err != nil {
		return engine.InferenceResult{}, fmt.Errorf("calling component: %w", err)
	}
	if resp.StatusCode() != http.StatusOK {
		return engine.InferenceResult{}, fmt.Errorf("component returned %d: %s", resp.StatusCode(), inferErrorMessage(resp))
	}
	if resp.JSON200 == nil {
		return engine.InferenceResult{}, fmt.Errorf("component returned 200 with no result body")
	}
	return toDomainResult(resp.JSON200.Result)
}

// toDomainResult maps the generated union onto the domain result, keeping the api
// type out of the engine. An unrecognised task means the component is newer than
// this engine — reported rather than passed through, since a caller keying off the
// task would silently mis-read the payload.
func toDomainResult(r mlapi.InferenceResult) (engine.InferenceResult, error) {
	task, err := r.Discriminator()
	if err != nil {
		return engine.InferenceResult{}, fmt.Errorf("reading result task: %w", err)
	}
	switch mlapi.Task(task) {
	case mlapi.TaskObjectDetection, mlapi.TaskImageClassification, mlapi.TaskTensor:
	default:
		return engine.InferenceResult{}, fmt.Errorf("component returned unknown task %q", task)
	}
	raw, err := r.MarshalJSON()
	if err != nil {
		return engine.InferenceResult{}, fmt.Errorf("reading result payload: %w", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return engine.InferenceResult{}, fmt.Errorf("decoding result payload: %w", err)
	}
	return engine.InferenceResult{Task: task, Payload: payload}, nil
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

// inferErrorMessage extracts the component's error message from a non-2xx
// response, falling back to the HTTP status text.
func inferErrorMessage(resp *mlapi.InferResponse) string {
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
// selfHostedEndpoints); those are skipped here by discriminator. An unbound or
// unconfigured ML model is a deploy error. Many models may resolve to the same
// component url — expected, since one component serves a repository of models and the
// model name is sent per request. No network call is made here.
func buildDeployML(wf *workflowapi.Workflow, rm engine.ResourceMapping, ext *engine.ExternalResources) (map[string]*mlEndpoint, error) {
	endpoints := make(map[string]*mlEndpoint)
	for _, mu := range wf.Models {
		disc, err := mu.Discriminator()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		if disc != string(workflowapi.MLModelTypeMLModel) {
			continue
		}
		m, err := mu.AsMLModel()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		b, ok := rm[m.Id]
		if !ok || b.Ref == "" {
			return nil, fmt.Errorf("model %q: declared but not bound by the deployment mapping", m.Id)
		}
		var cfg engine.MLConfig
		if ext != nil {
			cfg, ok = ext.ML[b.Ref]
		}
		if !ok {
			return nil, fmt.Errorf("model %q: bound to %q but no ml inference config in deploy externalResources", m.Id, b.Ref)
		}
		client, err := mlapi.NewClientWithResponses(cfg.URL, mlapi.WithHTTPClient(&http.Client{Timeout: mlClientTimeout}))
		if err != nil {
			return nil, fmt.Errorf("model %q: building inference client: %w", m.Id, err)
		}
		// The component selects on the address's model sub-address, which the
		// mapping must supply (one component fronts a repository of models).
		if b.Model == nil || *b.Model == "" {
			return nil, fmt.Errorf("model %q: mapped to %q but the address carries no model name for the component to select on", m.Id, b.Ref)
		}
		endpoints[m.Id] = &mlEndpoint{client: client, modelName: *b.Model}
	}
	return endpoints, nil
}
