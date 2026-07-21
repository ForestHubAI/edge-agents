// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package resource

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/mlapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeDoer is a stub HttpRequestDoer that captures the request and returns a
// canned response.
type fakeDoer struct {
	gotContentType string
	gotPath        string
	gotBody        string
	resp           *http.Response
}

func (f *fakeDoer) Do(req *http.Request) (*http.Response, error) {
	f.gotContentType = req.Header.Get("Content-Type")
	f.gotPath = req.URL.Path
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

func mlClientWith(t *testing.T, doer *fakeDoer) *mlClient {
	t.Helper()
	client, err := mlapi.NewClientWithResponses("http://onnx:9000", mlapi.WithHTTPClient(doer))
	require.NoError(t, err)
	return &mlClient{client: client, modelName: "yolo"}
}

func TestMLClient_InferTensors_Success(t *testing.T) {
	doer := &fakeDoer{resp: jsonResp(200, `{"task":"image-classification","predictions":[{"label":"cat","score":0.9}]}`)}
	ep := mlClientWith(t, doer)

	result, err := ep.InferTensors(context.Background(), map[string]any{"x": float64(1)})
	require.NoError(t, err)
	// The generated union is mapped onto the domain result: task is lifted out and
	// the whole task-shaped payload is carried through.
	assert.Equal(t, "image-classification", result.Task)
	assert.Equal(t, "image-classification", result.Payload["task"])
	assert.Len(t, result.Payload["predictions"], 1)

	// The tensors ride as a JSON body to the model's /infer/tensors endpoint; the
	// model is in the path, not the body.
	assert.Equal(t, "/models/yolo/infer/tensors", doer.gotPath)
	assert.Contains(t, doer.gotContentType, "application/json")
	assert.Contains(t, doer.gotBody, `"x":1`)
}

func TestMLClient_InferBinary_Success(t *testing.T) {
	doer := &fakeDoer{resp: jsonResp(200, `{"task":"object-detection","detections":[]}`)}
	ep := mlClientWith(t, doer)

	result, err := ep.InferBinary(context.Background(), []byte{0xFF, 0xD8, 0xFF})
	require.NoError(t, err)
	assert.Equal(t, "object-detection", result.Task)
	assert.Equal(t, []any{}, result.Payload["detections"])

	// The blob is the raw request body to the model's /infer/binary endpoint.
	assert.Equal(t, "/models/yolo/infer/binary", doer.gotPath)
	assert.Contains(t, doer.gotContentType, "application/octet-stream")
	assert.Equal(t, string([]byte{0xFF, 0xD8, 0xFF}), doer.gotBody)
}

func TestMLClient_UnknownTask(t *testing.T) {
	// A task this engine's contract does not know means the component is newer than
	// the engine; mapping rejects it rather than passing a payload a task-keyed
	// caller would silently mis-read.
	doer := &fakeDoer{resp: jsonResp(200, `{"task":"image-segmentation","masks":[]}`)}
	ep := mlClientWith(t, doer)

	_, err := ep.InferTensors(context.Background(), map[string]any{"x": float64(1)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown task")
}

func TestMLClient_NotFound(t *testing.T) {
	doer := &fakeDoer{resp: jsonResp(404, `{"message":"no model named yolo is loaded"}`)}
	ep := mlClientWith(t, doer)

	_, err := ep.InferTensors(context.Background(), map[string]any{"x": float64(1)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "404")
	assert.Contains(t, err.Error(), "no model named yolo is loaded")
}

func TestMLClient_Unprocessable(t *testing.T) {
	doer := &fakeDoer{resp: jsonResp(422, `{"message":"input could not be processed"}`)}
	ep := mlClientWith(t, doer)

	_, err := ep.InferTensors(context.Background(), map[string]any{"x": float64(1)})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "422")
	assert.Contains(t, err.Error(), "input could not be processed")
}
