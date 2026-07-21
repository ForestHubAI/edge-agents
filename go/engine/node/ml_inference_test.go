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

// stubInferClient is a fake engine.MLClient that records its input and
// returns a canned result/error.
type stubInferClient struct {
	gotTensors map[string]any
	gotBinary  []byte
	result     map[string]any
	task       string
	err        error
}

func (s *stubInferClient) infer() (engine.InferenceResult, error) {
	task := s.task
	if task == "" {
		task = "tensor"
	}
	return engine.InferenceResult{Task: task, Payload: s.result}, s.err
}

func (s *stubInferClient) InferTensors(_ context.Context, tensors map[string]any) (engine.InferenceResult, error) {
	s.gotTensors = tensors
	return s.infer()
}

func (s *stubInferClient) InferBinary(_ context.Context, data []byte) (engine.InferenceResult, error) {
	s.gotBinary = data
	return s.infer()
}

// inputRef is the reference every test wires as the ML input: a declared
// variable named "in", seeded per-test with the value under test.
func inputRef() workflowapi.Reference {
	return workflowapi.Reference{SrcId: engine.SrcDeclared, VarId: "in"}
}

// scopeWithInput declares the "in" variable and seeds it with v, the way an
// upstream node (e.g. CameraCapture) would before MLInference runs.
func scopeWithInput(t *testing.T, dt workflowapi.DataType, v expr.Value) *engine.Scope {
	t.Helper()
	s, err := engine.NewMainScope([]workflowapi.Variable{{Uid: "in", DataType: dt}})
	require.NoError(t, err)
	s.Set(engine.SrcDeclared, "in", v)
	return s
}

func TestMLInference_Execute(t *testing.T) {
	emit := workflowapi.OutputBinding{Active: true, Mode: workflowapi.OutputBindingModeEmit}

	t.Run("string input is parsed to tensors and result is emitted as json", func(t *testing.T) {
		s := scopeWithInput(t, workflowapi.String, expr.StringVal(`{"x":1}`))

		client := &stubInferClient{result: map[string]any{"ok": true}}
		n := NewMLInference("ml1", inputRef(), emit, client)

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		// The JSON string variable reached the client as a parsed tensors object.
		assert.Equal(t, map[string]any{"x": float64(1)}, client.gotTensors)

		// The result was applied to the bound slot as a JSON string.
		v, err := s.Resolve(workflowapi.Reference{SrcId: "ml1", VarId: mlInferenceOutID})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal(`{"ok":true}`), v)
	})

	t.Run("image input is sent as binary and result is emitted as json", func(t *testing.T) {
		// A plain variable reference — the exact shape the builder emits. The
		// frame reaches InferBinary because the variable's runtime type is Image,
		// not because of any declared expression type.
		frame := []byte{0xFF, 0xD8, 0xFF}
		s := scopeWithInput(t, workflowapi.Image, expr.ImageVal(frame))

		client := &stubInferClient{result: map[string]any{"ok": true}}
		n := NewMLInference("mlImg", inputRef(), emit, client)

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		// The frame reached the client as raw bytes, not tensors.
		assert.Equal(t, frame, client.gotBinary)
		assert.Nil(t, client.gotTensors)

		v, err := s.Resolve(workflowapi.Reference{SrcId: "mlImg", VarId: mlInferenceOutID})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal(`{"ok":true}`), v)
	})

	t.Run("empty image input is rejected before the client is called", func(t *testing.T) {
		// A declared image referenced before any CameraCapture fired carries no
		// bytes; it must not be forwarded to the component as an empty frame.
		s := scopeWithInput(t, workflowapi.Image, expr.ImageVal(nil))

		client := &stubInferClient{result: map[string]any{"ok": true}}
		n := NewMLInference("mlEmpty", inputRef(), emit, client)

		_, err := n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "image input is empty")
		assert.Nil(t, client.gotBinary, "client must not be called for an empty image")
	})

	t.Run("inference error is wrapped with node id", func(t *testing.T) {
		s := scopeWithInput(t, workflowapi.String, expr.StringVal(`{"x":1}`))

		client := &stubInferClient{err: errors.New("component returned 404: no model")}
		n := NewMLInference("mlErr", inputRef(), emit, client)

		_, err := n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "ml_inference mlErr")
		assert.Contains(t, err.Error(), "404")
	})

	t.Run("unsupported input type is rejected", func(t *testing.T) {
		s := scopeWithInput(t, workflowapi.Int, expr.IntVal(42))

		client := &stubInferClient{result: map[string]any{}}
		n := NewMLInference("mlType", inputRef(), emit, client)

		_, err := n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "unsupported input type")
		assert.Nil(t, client.gotTensors, "client must not be called for an unsupported type")
	})

	t.Run("malformed json input is wrapped", func(t *testing.T) {
		s := scopeWithInput(t, workflowapi.String, expr.StringVal("not json"))

		client := &stubInferClient{result: map[string]any{}}
		n := NewMLInference("mlJSON", inputRef(), emit, client)

		_, err := n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "ml_inference mlJSON")
		assert.Contains(t, err.Error(), "JSON tensors object")
		assert.Nil(t, client.gotTensors, "client must not be called for malformed input")
	})
}

func TestMLInference_Outputs(t *testing.T) {
	t.Run("emit binding materializes the string result slot", func(t *testing.T) {
		n := NewMLInference("ml1", inputRef(), workflowapi.OutputBinding{Active: true, Mode: workflowapi.OutputBindingModeEmit}, &stubInferClient{})
		assert.Equal(t, map[string]workflowapi.DataType{mlInferenceOutID: workflowapi.String}, n.Outputs())
	})

	t.Run("assign binding materializes no slot", func(t *testing.T) {
		n := NewMLInference("ml1", inputRef(), workflowapi.OutputBinding{Active: true, Mode: workflowapi.OutputBindingModeAssign}, &stubInferClient{})
		assert.Empty(t, n.Outputs())
	})
}
