// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/captureapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func cameraChannel(t *testing.T, id string, width, height *int) workflowapi.Channel {
	t.Helper()
	var c workflowapi.Channel
	require.NoError(t, c.FromCAMERAChannel(workflowapi.CAMERAChannel{
		Type:   workflowapi.CAMERA,
		Id:     id,
		Label:  id,
		Width:  width,
		Height: height,
	}))
	return c
}

func mqttChannel(t *testing.T, id string) workflowapi.Channel {
	t.Helper()
	var c workflowapi.Channel
	require.NoError(t, c.FromMQTTChannel(workflowapi.MQTTChannel{
		Type:  workflowapi.MQTT,
		Id:    id,
		Label: id,
		Topic: "t",
	}))
	return c
}

func TestBuildDeployCapture_ResolvesCamera(t *testing.T) {
	wf := &workflowapi.Workflow{Channels: []workflowapi.Channel{cameraChannel(t, "front", nil, nil)}}
	dm := engine.ResourceMapping{"front": {Ref: "cam-component"}}
	ext := &engine.ExternalResources{Cameras: map[string]engine.CameraConfig{
		"cam-component": {URL: "http://fh-camera:8100"},
	}}

	eps, err := buildDeployCapture(wf, dm, ext)
	require.NoError(t, err)
	require.Len(t, eps, 1)
	ep := eps["front"]
	require.NotNil(t, ep)
	assert.Equal(t, "front", ep.name)
	assert.NotNil(t, ep.client)
}

func TestBuildDeployCapture_SkipsNonCamera(t *testing.T) {
	// wf.Channels holds every channel kind; a non-camera must not produce an endpoint.
	wf := &workflowapi.Workflow{Channels: []workflowapi.Channel{mqttChannel(t, "bus")}}

	eps, err := buildDeployCapture(wf, nil, nil)
	require.NoError(t, err)
	assert.Empty(t, eps)
}

func TestBuildDeployCapture_UnboundFails(t *testing.T) {
	wf := &workflowapi.Workflow{Channels: []workflowapi.Channel{cameraChannel(t, "front", nil, nil)}}

	_, err := buildDeployCapture(wf, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not bound")
}

func TestBuildDeployCapture_BoundButNoConfigFails(t *testing.T) {
	wf := &workflowapi.Workflow{Channels: []workflowapi.Channel{cameraChannel(t, "front", nil, nil)}}
	dm := engine.ResourceMapping{"front": {Ref: "missing"}}
	ext := &engine.ExternalResources{Cameras: map[string]engine.CameraConfig{}}

	_, err := buildDeployCapture(wf, dm, ext)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no camera config")
}

func TestBuildDeployCapture_MultipleShareURL(t *testing.T) {
	// One component owns a set of cameras, so many channels may share a ref.
	wf := &workflowapi.Workflow{Channels: []workflowapi.Channel{
		cameraChannel(t, "front", nil, nil),
		cameraChannel(t, "rear", nil, nil),
	}}
	dm := engine.ResourceMapping{"front": {Ref: "cam"}, "rear": {Ref: "cam"}}
	ext := &engine.ExternalResources{Cameras: map[string]engine.CameraConfig{
		"cam": {URL: "http://fh-camera:8100"},
	}}

	eps, err := buildDeployCapture(wf, dm, ext)
	require.NoError(t, err)
	assert.Len(t, eps, 2)
}

func captureEndpointAgainst(t *testing.T, srv *httptest.Server, name string, width, height int) *captureEndpoint {
	t.Helper()
	client, err := captureapi.NewClientWithResponses(srv.URL)
	require.NoError(t, err)
	return &captureEndpoint{client: client, name: name, width: width, height: height}
}

func TestCaptureEndpoint_Capture_Success(t *testing.T) {
	var gotName, gotWidth, gotHeight string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		gotName, gotWidth, gotHeight = q.Get("name"), q.Get("width"), q.Get("height")
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte{0xFF, 0xD8, 0xFF})
	}))
	defer srv.Close()

	ep := captureEndpointAgainst(t, srv, "front", 640, 480)
	frame, err := ep.Capture(context.Background())
	require.NoError(t, err)
	assert.Equal(t, []byte{0xFF, 0xD8, 0xFF}, frame)

	// The bound name and size reach the component as query params.
	assert.Equal(t, "front", gotName)
	assert.Equal(t, "640", gotWidth)
	assert.Equal(t, "480", gotHeight)
}

func TestCaptureEndpoint_Capture_OmitsUnsetSize(t *testing.T) {
	var gotWidth, gotHeight string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		gotWidth, gotHeight = q.Get("width"), q.Get("height")
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write([]byte{0xFF, 0xD8})
	}))
	defer srv.Close()

	ep := captureEndpointAgainst(t, srv, "front", 0, 0)
	_, err := ep.Capture(context.Background())
	require.NoError(t, err)

	// Zero size means "native resolution" — no param is sent.
	assert.Empty(t, gotWidth)
	assert.Empty(t, gotHeight)
}

func TestCaptureEndpoint_Capture_NotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"no camera named front"}`))
	}))
	defer srv.Close()

	ep := captureEndpointAgainst(t, srv, "front", 0, 0)
	_, err := ep.Capture(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "404")
	assert.Contains(t, err.Error(), "no camera named front")
}

func TestCaptureEndpoint_Capture_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"message":"gstreamer pipeline failed"}`))
	}))
	defer srv.Close()

	ep := captureEndpointAgainst(t, srv, "front", 0, 0)
	_, err := ep.Capture(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "500")
	assert.Contains(t, err.Error(), "gstreamer pipeline failed")
}

func TestCaptureEndpoint_Capture_EmptyBodyRejected(t *testing.T) {
	// A 200 with no bytes is a component bug; it must not surface as an empty frame.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	ep := captureEndpointAgainst(t, srv, "front", 0, 0)
	_, err := ep.Capture(context.Background())
	require.Error(t, err)
	assert.Contains(t, err.Error(), "empty frame")
}
