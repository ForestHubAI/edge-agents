// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/mlapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mlModel(t *testing.T, id string) workflowapi.Model {
	t.Helper()
	var m workflowapi.Model
	require.NoError(t, m.FromMLModel(workflowapi.MLModel{
		Type:  workflowapi.MLModelTypeMLModel,
		Id:    id,
		Label: id,
	}))
	return m
}

func TestBuildDeployML_ResolvesMLModel(t *testing.T) {
	name := "yolov8n"
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "onnx-1", Model: &name}}
	ext := &engine.ExternalResources{ML: map[string]engine.MLConfig{
		"onnx-1": {URL: "http://onnx:9000"},
	}}

	eps, err := buildDeployML(wf, dm, ext)
	require.NoError(t, err)
	require.Len(t, eps, 1)
	ep := eps["yolo"]
	require.NotNil(t, ep)
	// The component selector comes from the address's model sub-address, not the workflow id.
	assert.Equal(t, "yolov8n", ep.modelName)
	assert.NotNil(t, ep.client)
}

func TestBuildDeployML_UnsetModelFails(t *testing.T) {
	// A model-bearing address must carry the name the component selects on; a
	// missing one is a malformed mapping, not a silent default.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "onnx-1"}}
	ext := &engine.ExternalResources{ML: map[string]engine.MLConfig{
		"onnx-1": {URL: "http://onnx:9000"},
	}}

	_, err := buildDeployML(wf, dm, ext)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no model name")
}

func TestBuildDeployML_SkipsLLMModel(t *testing.T) {
	// wf.Models holds both kinds; an LLM model must not produce an ML endpoint.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{llmModel(t, "my-llama")}}

	eps, err := buildDeployML(wf, nil, nil)
	require.NoError(t, err)
	assert.Empty(t, eps)
}

func TestBuildDeployML_UnboundFails(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}

	_, err := buildDeployML(wf, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not bound")
}

func TestBuildDeployML_BoundButNoConfigFails(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "missing"}}
	ext := &engine.ExternalResources{ML: map[string]engine.MLConfig{}}

	_, err := buildDeployML(wf, dm, ext)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no ml inference config")
}

func TestBuildDeployML_MultipleModelsShareURL(t *testing.T) {
	// One component serves a repository of models, so many models may share a ref.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{
		mlModel(t, "yolo"),
		mlModel(t, "resnet"),
	}}
	dm := engine.ResourceMapping{
		"yolo":   {Ref: "onnx", Model: pointer.Ptr("yolov8n")},
		"resnet": {Ref: "onnx", Model: pointer.Ptr("resnet50")},
	}
	ext := &engine.ExternalResources{ML: map[string]engine.MLConfig{
		"onnx": {URL: "http://onnx:9000"},
	}}

	eps, err := buildDeployML(wf, dm, ext)
	require.NoError(t, err)
	assert.Len(t, eps, 2)
}

// fakeDoer is a stub HttpRequestDoer that captures the request and returns a
// canned response.
type fakeDoer struct {
	gotContentType string
	gotBody        string
	resp           *http.Response
}

func (f *fakeDoer) Do(req *http.Request) (*http.Response, error) {
	f.gotContentType = req.Header.Get("Content-Type")
	if req.Body != nil {
		b, _ := io.ReadAll(req.Body)
		f.gotBody = string(b)
	}
	return f.resp, nil
}

func jsonResp(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func mlEndpointWith(t *testing.T, doer *fakeDoer) *mlEndpoint {
	t.Helper()
	client, err := mlapi.NewClientWithResponses("http://onnx:9000", mlapi.WithHTTPClient(doer))
	require.NoError(t, err)
	return &mlEndpoint{client: client, modelName: "yolo"}
}

func TestMLEndpoint_Infer_Success(t *testing.T) {
	doer := &fakeDoer{resp: jsonResp(200, `{"model":"clf","result":{"task":"image-classification","predictions":[{"label":"cat","score":0.9}]}}`)}
	ep := mlEndpointWith(t, doer)

	result, err := ep.InferTensors(context.Background(), map[string]any{"x": float64(1)})
	require.NoError(t, err)
	// The generated union is mapped onto the domain result: task is lifted out and
	// the whole task-shaped payload is carried through.
	assert.Equal(t, "image-classification", result.Task)
	assert.Equal(t, "image-classification", result.Payload["task"])
	assert.Len(t, result.Payload["predictions"], 1)

	// The request was a multipart body carrying the model selector and tensors.
	assert.Contains(t, doer.gotContentType, "multipart/form-data")
	assert.Contains(t, doer.gotBody, `name="model"`)
	assert.Contains(t, doer.gotBody, "yolo")
	assert.Contains(t, doer.gotBody, `name="tensors"`)
	assert.Contains(t, doer.gotBody, `"x":1`)
}

func TestMLEndpoint_InferBinary_Success(t *testing.T) {
	doer := &fakeDoer{resp: jsonResp(200, `{"model":"yolo","result":{"task":"object-detection","detections":[]}}`)}
	ep := mlEndpointWith(t, doer)

	result, err := ep.InferBinary(context.Background(), []byte{0xFF, 0xD8, 0xFF})
	require.NoError(t, err)
	assert.Equal(t, "object-detection", result.Task)
	assert.Equal(t, []any{}, result.Payload["detections"])

	// The request was a multipart body carrying the model selector and the blob
	// as a file part named "binary".
	assert.Contains(t, doer.gotContentType, "multipart/form-data")
	assert.Contains(t, doer.gotBody, `name="model"`)
	assert.Contains(t, doer.gotBody, "yolo")
	assert.Contains(t, doer.gotBody, `name="binary"`)
	assert.Contains(t, doer.gotBody, `filename="frame"`)
	assert.Contains(t, doer.gotBody, "application/octet-stream")
}

func TestMLEndpoint_Infer_UnknownTask(t *testing.T) {
	// A task this engine's contract does not know means the component is newer than
	// the engine; mapping rejects it rather than passing a payload a task-keyed
	// caller would silently mis-read.
	doer := &fakeDoer{resp: jsonResp(200, `{"model":"seg","result":{"task":"image-segmentation","masks":[]}}`)}
	ep := mlEndpointWith(t, doer)

	_, err := ep.InferTensors(context.Background(), map[string]any{"x": float64(1)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown task")
}

func TestMLEndpoint_Infer_NotFound(t *testing.T) {
	doer := &fakeDoer{resp: jsonResp(404, `{"message":"no model named yolo is loaded"}`)}
	ep := mlEndpointWith(t, doer)

	_, err := ep.InferTensors(context.Background(), map[string]any{"x": float64(1)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "404")
	assert.Contains(t, err.Error(), "no model named yolo is loaded")
}

func TestMLEndpoint_Infer_Unprocessable(t *testing.T) {
	doer := &fakeDoer{resp: jsonResp(422, `{"message":"input could not be processed"}`)}
	ep := mlEndpointWith(t, doer)

	_, err := ep.InferTensors(context.Background(), map[string]any{"x": float64(1)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "422")
	assert.Contains(t, err.Error(), "input could not be processed")
}
