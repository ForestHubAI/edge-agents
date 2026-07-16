// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package driver

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/ForestHubAI/edge-agents/go/component"
)

// captureTimeout bounds a single capture call. It sits above the driver
// component's worst case (its CaptureTimeout of 15s plus a 5s WaitDelay) so the
// component's own 500 wins the race, while still freeing the caller if the
// component is unreachable.
const captureTimeout = 25 * time.Second

// CameraDriver captures stills from one camera. Unlike the other families it is
// out-of-process: the capture stack (GStreamer, libcamera, vendor userland) is too
// heavy for the engine image, so it lives in a driver component the engine issues
// privately and reaches over HTTP. That is a packaging detail — a camera is
// device-owned hardware and resolves from the DeviceManifest like any gpiochip.
//
// Width and height are per-call because one camera is shared by every channel
// bound to it, and each channel may ask for its own size.
type CameraDriver interface {
	Driver
	Capture(ctx context.Context, width, height int) ([]byte, error)
}

// cameraComponentURL is where the driver component listens. A constant, not
// config: the component is a singleton the engine issues itself, so there is
// nothing for an operator to point at.
func cameraComponentURL() string {
	return fmt.Sprintf("http://%s:%d", component.Camera, component.CameraPort)
}

// httpCamera reaches one camera through the driver component, naming it by its
// manifest key on each request.
type httpCamera struct {
	client *cameraapi.ClientWithResponses
	name   string
}

var _ CameraDriver = (*httpCamera)(nil)

// OpenCamera binds a driver to the camera registered under name. No network call
// is made: the component is issued alongside this engine and may still be
// starting, and it is only deployed when a workflow binds a camera at all — so
// reachability is not a fact this can establish at boot.
func OpenCamera(baseURL, name string) (CameraDriver, error) {
	client, err := cameraapi.NewClientWithResponses(baseURL, cameraapi.WithHTTPClient(&http.Client{Timeout: captureTimeout}))
	if err != nil {
		return nil, fmt.Errorf("building capture client: %w", err)
	}
	return &httpCamera{client: client, name: name}, nil
}

// Capture asks the component for one frame from the bound camera and returns the
// encoded bytes. Width and height are sent only when set.
func (c *httpCamera) Capture(ctx context.Context, width, height int) ([]byte, error) {
	params := &cameraapi.CaptureParams{Name: c.name}
	if width > 0 {
		params.Width = &width
	}
	if height > 0 {
		params.Height = &height
	}
	resp, err := c.client.CaptureWithResponse(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("calling camera component: %w", err)
	}
	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("camera component returned %d: %s", resp.StatusCode(), captureErrorMessage(resp))
	}
	if len(resp.Body) == 0 {
		return nil, fmt.Errorf("camera component returned an empty frame")
	}
	return resp.Body, nil
}

// Close releases nothing: the driver owns no kernel handle, only an idle HTTP
// client, and the component's lifetime is the container's.
func (c *httpCamera) Close() error { return nil }

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
