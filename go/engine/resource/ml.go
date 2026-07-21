// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package resource

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/mlapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
)

// mlClientTimeout bounds a single inference call. Inference can be heavy, so the
// budget is generous, but it still frees the node if the component becomes
// unreachable or wedged rather than blocking the runner indefinitely.
const mlClientTimeout = 120 * time.Second

// mlClient is the HTTP adapter for one declared ML model: it implements
// engine.MLClient over the generated component client, binding the model name so
// callers pass only the input. Unlike the Registry families it is not opened at
// boot and holds no connection — one component fronts a repository of models,
// reached per request, so many mlClients may share a url and differ only by name.
type mlClient struct {
	client    *mlapi.ClientWithResponses
	modelName string
}

var _ engine.MLClient = (*mlClient)(nil)

// OpenML builds an inference client for one model served at the component url.
// No network call is made: the component is reached per request and may still be
// starting when the engine boots. The model name is what the component selects on
// (one component serves many models).
func OpenML(url, modelName string) (engine.MLClient, error) {
	client, err := mlapi.NewClientWithResponses(url, mlapi.WithHTTPClient(&http.Client{Timeout: mlClientTimeout}))
	if err != nil {
		return nil, fmt.Errorf("building inference client: %w", err)
	}
	return &mlClient{client: client, modelName: modelName}, nil
}

// InferTensors posts already-numeric named tensors to the model's /infer/tensors
// endpoint as a JSON body and returns the model's task-shaped result. The engine
// is a conduit for the tensors object the workflow produced — it forwards the JSON
// as-is and lets the component validate the shape (a mismatch is a 422).
func (e *mlClient) InferTensors(ctx context.Context, tensors map[string]any) (engine.InferenceResult, error) {
	body, err := json.Marshal(tensors)
	if err != nil {
		return engine.InferenceResult{}, fmt.Errorf("encoding tensors: %w", err)
	}
	resp, err := e.client.InferTensorsWithBodyWithResponse(ctx, e.modelName, "application/json", bytes.NewReader(body))
	if err != nil {
		return engine.InferenceResult{}, fmt.Errorf("calling component: %w", err)
	}
	return mapInferResponse(resp.StatusCode(), resp.Status(), resp.Body, resp.JSON200)
}

// InferBinary posts an opaque encoded blob (e.g. an image) to the model's
// /infer/binary endpoint as the raw request body and returns the model's
// task-shaped result.
func (e *mlClient) InferBinary(ctx context.Context, data []byte) (engine.InferenceResult, error) {
	resp, err := e.client.InferBinaryWithBodyWithResponse(ctx, e.modelName, "application/octet-stream", bytes.NewReader(data))
	if err != nil {
		return engine.InferenceResult{}, fmt.Errorf("calling component: %w", err)
	}
	return mapInferResponse(resp.StatusCode(), resp.Status(), resp.Body, resp.JSON200)
}

// mapInferResponse maps a component inference response onto the domain result,
// shared by the tensors and binary arms (both carry the same success/error shape).
func mapInferResponse(status int, statusText string, body []byte, json200 *mlapi.InferResult) (engine.InferenceResult, error) {
	if status != http.StatusOK {
		return engine.InferenceResult{}, fmt.Errorf("component returned %d: %s", status, inferErrorMessage(body, statusText))
	}
	if json200 == nil {
		return engine.InferenceResult{}, fmt.Errorf("component returned 200 with no result body")
	}
	return toDomainResult(*json200)
}

// toDomainResult maps the generated union onto the domain result, keeping the api
// type out of the engine. An unrecognised task means the component is newer than
// this engine — reported rather than passed through, since a caller keying off the
// task would silently mis-read the payload.
func toDomainResult(r mlapi.InferResult) (engine.InferenceResult, error) {
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

// inferErrorMessage pulls the component's error message from a non-2xx body,
// falling back to the HTTP status text. Every error response is the same Error
// shape whatever the status, so the body decodes uniformly.
func inferErrorMessage(body []byte, statusText string) string {
	var e mlapi.Error
	if err := json.Unmarshal(body, &e); err == nil && e.Message != "" {
		return e.Message
	}
	return statusText
}
