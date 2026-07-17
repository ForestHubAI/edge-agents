// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*CameraCapture)(nil)
var _ engine.Emitter = (*CameraCapture)(nil)

const cameraCaptureOutID = "output"

// CameraCapture grabs one frame from a capture component, emits it through the
// output binding as an opaque image value, and advances. Transport is the
// client's concern; this node only forwards the frame.
//
// width and height are this node's requested size, so two nodes may read one
// camera at different resolutions. Zero means "no hint" — the source picks its
// native resolution.
type CameraCapture struct {
	engine.LinearNode
	binding workflowapi.OutputBinding
	client  engine.CaptureClient
	width   int
	height  int
}

// NewCameraCapture builds a CameraCapture bound to one camera's capture client.
func NewCameraCapture(id string, binding workflowapi.OutputBinding, client engine.CaptureClient, width, height int) *CameraCapture {
	return &CameraCapture{
		LinearNode: engine.NewLinearNode(id),
		binding:    binding,
		client:     client,
		width:      width,
		height:     height,
	}
}

func (c *CameraCapture) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	frame, err := c.client.Capture(ctx, c.width, c.height)
	if err != nil {
		return "", fmt.Errorf("cameraCapture %s: %w", c.ID(), err)
	}
	if err := engine.ApplyOutput(scope, c.ID(), cameraCaptureOutID, c.binding, expr.ImageVal(frame)); err != nil {
		return "", fmt.Errorf("cameraCapture %s: applying output: %w", c.ID(), err)
	}
	return c.Next(engine.PortCtrl, scope)
}

// Outputs declares the single "output" slot — an image. Returns it only if the
// binding is emit-mode (assign/discard don't materialize a variable).
func (c *CameraCapture) Outputs() map[string]workflowapi.DataType {
	return engine.FilterEmitted(
		map[string]workflowapi.DataType{cameraCaptureOutID: workflowapi.Image},
		map[string]workflowapi.OutputBinding{cameraCaptureOutID: c.binding},
	)
}
