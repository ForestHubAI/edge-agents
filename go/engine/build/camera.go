// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
)

// captureClientTimeout bounds a single capture call. It sits above the component's
// worst case (captureTimeout 15s + WaitDelay 5s) so the component's own 500 wins the
// race, while still freeing the node if the component is unreachable.
const captureClientTimeout = 25 * time.Second

// captureEndpoint is the HTTP adapter for one declared camera channel: it
// implements engine.CaptureClient over the generated component client, binding
// the camera name and capture size so callers pass only the context.
type captureEndpoint struct {
	client *cameraapi.ClientWithResponses
	name   string
	width  int
	height int
}

var _ engine.CaptureClient = (*captureEndpoint)(nil)

// Capture asks the component for one frame from the bound camera and returns the
// encoded bytes. Width and height are sent only when set.
func (e *captureEndpoint) Capture(ctx context.Context) ([]byte, error) {
	params := &cameraapi.CaptureParams{Name: e.name}
	if e.width > 0 {
		params.Width = &e.width
	}
	if e.height > 0 {
		params.Height = &e.height
	}
	resp, err := e.client.CaptureWithResponse(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("calling component: %w", err)
	}
	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("component returned %d: %s", resp.StatusCode(), captureErrorMessage(resp))
	}
	if len(resp.Body) == 0 {
		return nil, fmt.Errorf("component returned an empty frame")
	}
	return resp.Body, nil
}

// captureErrorMessage extracts the component's error message from a non-2xx
// response, falling back to the HTTP status text.
func captureErrorMessage(resp *cameraapi.CaptureResponse) string {
	switch {
	case resp.JSON404 != nil:
		return resp.JSON404.Message
	case resp.JSON500 != nil:
		return resp.JSON500.Message
	default:
		return resp.Status()
	}
}

// buildDeployCapture resolves a workflow's declared camera channels into
// per-camera capture endpoints. A CAMERA channel that is unbound or points at a
// missing config is a deploy error. Many cameras may resolve to the same component
// url — expected, since one component owns a set of cameras and the camera name is
// sent per request. No network call is made here.
func buildDeployCapture(wf *workflowapi.Workflow, dm engine.ResourceMapping, ext *engine.ExternalResources) (map[string]*captureEndpoint, error) {
	endpoints := make(map[string]*captureEndpoint)
	for _, cu := range wf.Channels {
		disc, err := cu.Discriminator()
		if err != nil {
			return nil, fmt.Errorf("declared channel: %w", err)
		}
		if disc != string(workflowapi.CAMERA) {
			continue
		}
		ch, err := cu.AsCAMERAChannel()
		if err != nil {
			return nil, fmt.Errorf("declared channel: %w", err)
		}
		b, ok := dm[ch.Id]
		if !ok || b.Ref == "" {
			return nil, fmt.Errorf("camera %q: declared but not bound by the deployment mapping", ch.Id)
		}
		var cfg engine.CameraConfig
		if ext != nil {
			cfg, ok = ext.Cameras[b.Ref]
		}
		if !ok {
			return nil, fmt.Errorf("camera %q: bound to %q but no camera config in deploy externalResources", ch.Id, b.Ref)
		}
		client, err := cameraapi.NewClientWithResponses(cfg.URL, cameraapi.WithHTTPClient(&http.Client{Timeout: captureClientTimeout}))
		if err != nil {
			return nil, fmt.Errorf("camera %q: building capture client: %w", ch.Id, err)
		}
		endpoints[ch.Id] = &captureEndpoint{
			client: client,
			name:   ch.Id,
			width:  derefInt(ch.Width),
			height: derefInt(ch.Height),
		}
	}
	return endpoints, nil
}

// derefInt returns the pointed-to int, or zero when the pointer is nil.
func derefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}
