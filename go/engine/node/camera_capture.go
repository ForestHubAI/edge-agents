package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*CameraCapture)(nil)
var _ engine.Emitter = (*CameraCapture)(nil)

const cameraCaptureOutID = "output"

// CameraCapture grabs one frame from a capture sidecar, emits it through the
// output binding as an opaque image value, and advances. Transport is the
// client's concern; this node only forwards the frame.
type CameraCapture struct {
	engine.LinearNode
	binding workflow.OutputBinding
	client  engine.CaptureClient
}

// NewCameraCapture builds a CameraCapture bound to one camera's capture client.
func NewCameraCapture(id string, binding workflow.OutputBinding, client engine.CaptureClient) *CameraCapture {
	return &CameraCapture{
		LinearNode: engine.NewLinearNode(id),
		binding:    binding,
		client:     client,
	}
}

func (c *CameraCapture) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	frame, err := c.client.Capture(ctx)
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
func (c *CameraCapture) Outputs() map[string]workflow.DataType {
	return engine.FilterEmitted(
		map[string]workflow.DataType{cameraCaptureOutID: workflow.Image},
		map[string]workflow.OutputBinding{cameraCaptureOutID: c.binding},
	)
}
