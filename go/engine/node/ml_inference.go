package node

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*MLInference)(nil)
var _ engine.Emitter = (*MLInference)(nil)

const mlInferenceOutID = "output"

// MLInference runs one inference against an ML sidecar and emits its result.
// It evaluates the configured input expression, runs it through the bound
// inference client, and writes the handler-produced result to the bound slot as
// a JSON string. Control-flow only — not exposed as an LLM tool. Transport is
// the client's concern; this node only interprets the input and the result.
type MLInference struct {
	engine.LinearNode
	input   workflow.Expression
	binding workflow.OutputBinding
	client  engine.MLInferenceClient
}

// NewMLInference builds an MLInference node bound to one model's inference client.
func NewMLInference(id string, input workflow.Expression, binding workflow.OutputBinding, client engine.MLInferenceClient) *MLInference {
	return &MLInference{
		LinearNode: engine.NewLinearNode(id),
		input:      input,
		binding:    binding,
		client:     client,
	}
}

func (n *MLInference) Outputs() map[string]workflow.DataType {
	return engine.FilterEmitted(
		map[string]workflow.DataType{mlInferenceOutID: workflow.String},
		map[string]workflow.OutputBinding{mlInferenceOutID: n.binding},
	)
}

func (n *MLInference) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	v, err := expr.Eval(n.input, scope)
	if err != nil {
		return "", fmt.Errorf("ml_inference %s: input: %w", n.ID(), err)
	}

	// The input type selects how it reaches the model. String carries a JSON
	// tensors object today; a future binary/image type slots in as another arm.
	var result map[string]any
	switch v.Type {
	case workflow.String:
		result, err = n.inferTensors(ctx, v.AsString())
	default:
		return "", fmt.Errorf("ml_inference %s: unsupported input type %q (expects a JSON tensors string)", n.ID(), v.Type)
	}
	if err != nil {
		return "", fmt.Errorf("ml_inference %s: %w", n.ID(), err)
	}

	out, err := json.Marshal(result)
	if err != nil {
		return "", fmt.Errorf("ml_inference %s: encoding result: %w", n.ID(), err)
	}
	if err := engine.ApplyOutput(scope, n.ID(), mlInferenceOutID, n.binding, expr.StringVal(string(out))); err != nil {
		return "", fmt.Errorf("ml_inference %s: applying output: %w", n.ID(), err)
	}
	return n.Next(engine.PortCtrl, scope)
}

// inferTensors parses a JSON tensors object from the input and runs it through
// the inference client.
func (n *MLInference) inferTensors(ctx context.Context, raw string) (map[string]any, error) {
	var tensors map[string]any
	if err := json.Unmarshal([]byte(raw), &tensors); err != nil {
		return nil, fmt.Errorf("input is not a JSON tensors object: %w", err)
	}
	return n.client.Infer(ctx, tensors)
}
