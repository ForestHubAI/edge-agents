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

// stubInferClient is a fake engine.MLInferenceClient that records its input and
// returns a canned result/error.
type stubInferClient struct {
	gotTensors map[string]any
	result     map[string]any
	err        error
}

func (s *stubInferClient) Infer(_ context.Context, tensors map[string]any) (map[string]any, error) {
	s.gotTensors = tensors
	return s.result, s.err
}

func stringInput(s string) workflow.Expression {
	return workflow.Expression{Expression: s, DataType: workflow.String}
}

func TestMLInference_Execute(t *testing.T) {
	emit := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}

	t.Run("string input is parsed to tensors and result is emitted as json", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		client := &stubInferClient{result: map[string]any{"ok": true}}
		n := NewMLInference("ml1", stringInput(`{"x":1}`), emit, client)

		next, err := n.Execute(context.Background(), s)
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)

		// The JSON input reached the client as a parsed tensors object.
		assert.Equal(t, map[string]any{"x": float64(1)}, client.gotTensors)

		// The result was applied to the bound slot as a JSON string.
		v, err := s.Resolve(workflow.Reference{SrcId: "ml1", VarId: mlInferenceOutID})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal(`{"ok":true}`), v)
	})

	t.Run("inference error is wrapped with node id", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		client := &stubInferClient{err: errors.New("sidecar returned 404: no model")}
		n := NewMLInference("mlErr", stringInput(`{"x":1}`), emit, client)

		_, err = n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "ml_inference mlErr")
		assert.Contains(t, err.Error(), "404")
	})

	t.Run("non-string input type is rejected", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		client := &stubInferClient{result: map[string]any{}}
		n := NewMLInference("mlType",
			workflow.Expression{Expression: "42", DataType: workflow.Int},
			emit, client)

		_, err = n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "unsupported input type")
		assert.Nil(t, client.gotTensors, "client must not be called for an unsupported type")
	})

	t.Run("malformed json input is wrapped", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)

		client := &stubInferClient{result: map[string]any{}}
		n := NewMLInference("mlJSON", stringInput("not json"), emit, client)

		_, err = n.Execute(context.Background(), s)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "ml_inference mlJSON")
		assert.Contains(t, err.Error(), "JSON tensors object")
		assert.Nil(t, client.gotTensors, "client must not be called for malformed input")
	})
}
