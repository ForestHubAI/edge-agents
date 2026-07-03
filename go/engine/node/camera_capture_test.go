package node

import (
	"context"
	"errors"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubCaptureClient is a fake engine.CaptureClient that returns a canned
// frame/error.
type stubCaptureClient struct {
	frame []byte
	err   error
}

func (s *stubCaptureClient) Capture(_ context.Context) ([]byte, error) {
	return s.frame, s.err
}

func TestCameraCapture_Execute(t *testing.T) {
	emit := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}

	t.Run("captured frame is emitted as an image value", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		frame := []byte{0xFF, 0xD8, 0xFF}
		n := NewCameraCapture("cam1", emit, &stubCaptureClient{frame: frame})

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		v, err := s.Resolve(workflow.Reference{SrcId: "cam1", VarId: cameraCaptureOutID})
		require.NoError(t, err)
		assert.Equal(t, expr.ImageVal(frame), v)
	})

	t.Run("capture error is wrapped with node id", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		n := NewCameraCapture("camErr", emit, &stubCaptureClient{err: errors.New("sidecar returned 404: no camera")})

		_, err = n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "cameraCapture camErr")
		assert.Contains(t, err.Error(), "404")
	})
}

func TestCameraCapture_Outputs(t *testing.T) {
	t.Run("emit binding materializes the image slot", func(t *testing.T) {
		n := NewCameraCapture("cam1", workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}, &stubCaptureClient{})
		assert.Equal(t, map[string]workflow.DataType{cameraCaptureOutID: workflow.Image}, n.Outputs())
	})

	t.Run("assign binding materializes no slot", func(t *testing.T) {
		n := NewCameraCapture("cam1", workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeAssign}, &stubCaptureClient{})
		assert.Empty(t, n.Outputs())
	})
}
