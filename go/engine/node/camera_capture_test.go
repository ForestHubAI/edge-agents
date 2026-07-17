// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"errors"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubCaptureClient is a fake engine.CaptureClient that returns a canned
// frame/error and records the size it was asked for.
type stubCaptureClient struct {
	frame  []byte
	err    error
	width  int
	height int
}

func (s *stubCaptureClient) Capture(_ context.Context, width, height int) ([]byte, error) {
	s.width, s.height = width, height
	return s.frame, s.err
}

func TestCameraCapture_Execute(t *testing.T) {
	emit := workflowapi.OutputBinding{Active: true, Mode: workflowapi.OutputBindingModeEmit}

	t.Run("captured frame is emitted as an image value", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		frame := []byte{0xFF, 0xD8, 0xFF}
		n := NewCameraCapture("cam1", emit, &stubCaptureClient{frame: frame}, 0, 0)

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		v, err := s.Resolve(workflowapi.Reference{SrcId: "cam1", VarId: cameraCaptureOutID})
		require.NoError(t, err)
		assert.Equal(t, expr.ImageVal(frame), v)
	})

	t.Run("capture error is wrapped with node id", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		n := NewCameraCapture("camErr", emit, &stubCaptureClient{err: errors.New("component returned 404: no camera")}, 0, 0)

		_, err = n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "cameraCapture camErr")
		assert.Contains(t, err.Error(), "404")
	})

	t.Run("the node's size is what the camera is asked for", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		stub := &stubCaptureClient{frame: []byte{0xFF, 0xD8, 0xFF}}
		n := NewCameraCapture("cam1", emit, stub, 640, 480)

		_, err = n.Execute(context.Background(), s)
		require.NoError(t, err)
		// Size is this node's argument, not the camera's config: two nodes on one
		// camera may ask for different resolutions.
		assert.Equal(t, 640, stub.width)
		assert.Equal(t, 480, stub.height)
	})
}

func TestCameraCapture_Outputs(t *testing.T) {
	t.Run("emit binding materializes the image slot", func(t *testing.T) {
		n := NewCameraCapture("cam1", workflowapi.OutputBinding{Active: true, Mode: workflowapi.OutputBindingModeEmit}, &stubCaptureClient{}, 0, 0)
		assert.Equal(t, map[string]workflowapi.DataType{cameraCaptureOutID: workflowapi.Image}, n.Outputs())
	})

	t.Run("assign binding materializes no slot", func(t *testing.T) {
		n := NewCameraCapture("cam1", workflowapi.OutputBinding{Active: true, Mode: workflowapi.OutputBindingModeAssign}, &stubCaptureClient{}, 0, 0)
		assert.Empty(t, n.Outputs())
	})
}
