// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*MLInference)(nil)
var _ engine.Emitter = (*MLInference)(nil)

const mlInferenceOutID = "output"

// MLInference runs one inference against an ML sidecar and emits its result.
// It resolves the configured input variable, runs it through the bound
// inference client, and writes the handler-produced result to the bound slot as
// a JSON string. Control-flow only — not exposed as an LLM tool. Transport is
// the client's concern; this node only interprets the input and the result.
type MLInference struct {
	engine.LinearNode
	input   workflowapi.Reference
	binding workflowapi.OutputBinding
	client  engine.MLInferenceClient
}

// NewMLInference builds an MLInference node bound to one model's inference client.
func NewMLInference(id string, input workflowapi.Reference, binding workflowapi.OutputBinding, client engine.MLInferenceClient) *MLInference {
	return &MLInference{
		LinearNode: engine.NewLinearNode(id),
		input:      input,
		binding:    binding,
		client:     client,
	}
}

func (n *MLInference) Outputs() map[string]workflowapi.DataType {
	return engine.FilterEmitted(
		map[string]workflowapi.DataType{mlInferenceOutID: workflowapi.String},
		map[string]workflowapi.OutputBinding{mlInferenceOutID: n.binding},
	)
}

func (n *MLInference) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	v, err := scope.Resolve(n.input)
	if err != nil {
		return "", fmt.Errorf("ml_inference %s: input: %w", n.ID(), err)
	}

	// The input variable's runtime type selects how it reaches the model. String
	// carries a JSON tensors object; image carries an encoded frame sent as an
	// opaque blob. Further types dispatch to their handler as they are added.
	var result map[string]any
	switch v.Type {
	case workflowapi.String:
		result, err = n.inferTensors(ctx, v.AsString())
	case workflowapi.Image:
		result, err = n.inferImage(ctx, v)
	default:
		return "", fmt.Errorf("ml_inference %s: unsupported input type %q (expects a JSON tensors string or an image)", n.ID(), v.Type)
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
	return n.client.InferTensors(ctx, tensors)
}

// inferImage reads the raw frame bytes from the input and runs them through the
// inference client as an opaque binary blob.
func (n *MLInference) inferImage(ctx context.Context, v expr.Value) (map[string]any, error) {
	data, err := v.AsImage()
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("image input is empty")
	}
	return n.client.InferBinary(ctx, data)
}
