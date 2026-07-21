// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mlModel(t *testing.T, id string) workflowapi.Model {
	t.Helper()
	var m workflowapi.Model
	require.NoError(t, m.FromMLModel(workflowapi.MLModel{
		Type:  workflowapi.MLModelTypeMLModel,
		Id:    id,
		Label: id,
	}))
	return m
}

func TestBuildDeployML_ResolvesMLModel(t *testing.T) {
	name := "yolov8n"
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "onnx-1", Model: &name}}
	ext := &engine.ExternalResources{ML: map[string]engine.MLConfig{
		"onnx-1": {URL: "http://onnx:9000"},
	}}

	eps, err := buildDeployML(wf, dm, ext)
	require.NoError(t, err)
	require.Len(t, eps, 1)
	// One client, keyed by the workflow model id and bound to the mapped model
	// sub-address. The binding is now private to the resource client; that the
	// sub-address is required at all is covered by TestBuildDeployML_UnsetModelFails.
	require.NotNil(t, eps["yolo"])
}

func TestBuildDeployML_UnsetModelFails(t *testing.T) {
	// A model-bearing address must carry the name the component selects on; a
	// missing one is a malformed mapping, not a silent default.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "onnx-1"}}
	ext := &engine.ExternalResources{ML: map[string]engine.MLConfig{
		"onnx-1": {URL: "http://onnx:9000"},
	}}

	_, err := buildDeployML(wf, dm, ext)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no model name")
}

func TestBuildDeployML_SkipsLLMModel(t *testing.T) {
	// wf.Models holds both kinds; an LLM model must not produce an ML endpoint.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{llmModel(t, "my-llama")}}

	eps, err := buildDeployML(wf, nil, nil)
	require.NoError(t, err)
	assert.Empty(t, eps)
}

func TestBuildDeployML_UnboundFails(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}

	_, err := buildDeployML(wf, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not bound")
}

func TestBuildDeployML_BoundButNoConfigFails(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "missing"}}
	ext := &engine.ExternalResources{ML: map[string]engine.MLConfig{}}

	_, err := buildDeployML(wf, dm, ext)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no ml inference config")
}

func TestBuildDeployML_MultipleModelsShareURL(t *testing.T) {
	// One component serves a repository of models, so many models may share a ref.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{
		mlModel(t, "yolo"),
		mlModel(t, "resnet"),
	}}
	dm := engine.ResourceMapping{
		"yolo":   {Ref: "onnx", Model: pointer.Ptr("yolov8n")},
		"resnet": {Ref: "onnx", Model: pointer.Ptr("resnet50")},
	}
	ext := &engine.ExternalResources{ML: map[string]engine.MLConfig{
		"onnx": {URL: "http://onnx:9000"},
	}}

	eps, err := buildDeployML(wf, dm, ext)
	require.NoError(t, err)
	assert.Len(t, eps, 2)
}
