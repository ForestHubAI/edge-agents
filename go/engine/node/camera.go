package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*CameraCapture)(nil)
var _ engine.Emitter = (*CameraCapture)(nil)

const cameraCaptureOutID = "output"

// CameraCapture grabs one frame from a camera channel, emits it through the
// output binding as an opaque image value, and advances.
type CameraCapture struct {
	engine.LinearNode
	binding workflow.OutputBinding
	camera  *channel.Camera
}

// NewCameraCapture builds a CameraCapture bound to the given camera channel.
func NewCameraCapture(id string, binding workflow.OutputBinding, camera *channel.Camera) *CameraCapture {
	return &CameraCapture{
		LinearNode: engine.NewLinearNode(id),
		binding:    binding,
		camera:     camera,
	}
}

func (c *CameraCapture) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	frame, err := c.camera.Capture(ctx)
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
