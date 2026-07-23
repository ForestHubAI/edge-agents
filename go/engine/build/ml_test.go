// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/resource"
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

// mlRegistry opens a resource registry over the given resource bundle (ML
// providers only in these tests), the way boot does before buildDeployML
// resolves against it.
func mlRegistry(t *testing.T, res *engine.Resources) *resource.Registry {
	t.Helper()
	r, err := resource.NewRegistry(res)
	require.NoError(t, err)
	return r
}

func TestBuildDeployML_ResolvesMLModel(t *testing.T) {
	name := "yolov8n"
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "onnx-1", Model: &name}}
	res := &engine.Resources{ML: map[string]engine.MLProvider{
		"onnx-1": {URL: "http://onnx:9000"},
	}}

	eps, err := buildDeployML(wf, dm, mlRegistry(t, res))
	require.NoError(t, err)
	require.Len(t, eps, 1)
	b := eps["yolo"]
	require.NotNil(t, b.client)
	// The binding carries the component's model sub-address (yolov8n), not the
	// workflow id (yolo).
	assert.Equal(t, "yolov8n", b.model)
}

func TestBuildDeployML_UnsetModelFails(t *testing.T) {
	// A model-bearing address must carry the name the component selects on; a
	// missing one is a malformed mapping, not a silent default.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "onnx-1"}}
	res := &engine.Resources{ML: map[string]engine.MLProvider{
		"onnx-1": {URL: "http://onnx:9000"},
	}}

	_, err := buildDeployML(wf, dm, mlRegistry(t, res))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no model name")
}

func TestBuildDeployML_SkipsLLMModel(t *testing.T) {
	// wf.Models holds both kinds; an LLM model must not produce an ML binding.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{llmModel(t, "my-llama")}}

	eps, err := buildDeployML(wf, nil, mlRegistry(t, nil))
	require.NoError(t, err)
	assert.Empty(t, eps)
}

func TestBuildDeployML_UnboundFails(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}

	_, err := buildDeployML(wf, nil, mlRegistry(t, nil))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not bound")
}

func TestBuildDeployML_BoundButUnregisteredFails(t *testing.T) {
	// Bound to a ref with no MLProvider in resources.mlProviders: the registry never
	// opened a client for it, so the lookup fails.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{mlModel(t, "yolo")}}
	dm := engine.ResourceMapping{"yolo": {Ref: "missing"}}
	res := &engine.Resources{ML: map[string]engine.MLProvider{}}

	_, err := buildDeployML(wf, dm, mlRegistry(t, res))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not registered")
}

func TestBuildDeployML_MultipleModelsShareClient(t *testing.T) {
	// One component serves a repository of models, so many models share one client.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{
		mlModel(t, "yolo"),
		mlModel(t, "resnet"),
	}}
	dm := engine.ResourceMapping{
		"yolo":   {Ref: "onnx", Model: pointer.Ptr("yolov8n")},
		"resnet": {Ref: "onnx", Model: pointer.Ptr("resnet50")},
	}
	res := &engine.Resources{ML: map[string]engine.MLProvider{
		"onnx": {URL: "http://onnx:9000"},
	}}

	eps, err := buildDeployML(wf, dm, mlRegistry(t, res))
	require.NoError(t, err)
	require.Len(t, eps, 2)
	// Same ref → the same shared client, different model sub-addresses.
	assert.Same(t, eps["yolo"].client, eps["resnet"].client)
	assert.Equal(t, "yolov8n", eps["yolo"].model)
	assert.Equal(t, "resnet50", eps["resnet"].model)
}
