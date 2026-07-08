// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/llmapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/selfhosted"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func llmModel(t *testing.T, id string, caps ...llmapi.ModelCapability) workflow.Model {
	t.Helper()
	var m workflow.Model
	require.NoError(t, m.FromLLMModel(workflow.LLMModel{
		Type:         workflow.LLMModelTypeLLMModel,
		Id:           id,
		Label:        id,
		Capabilities: caps,
	}))
	return m
}

// agentNode builds a workflow Node wrapping an Agent that references model.
func agentNode(t *testing.T, id, model string) workflow.Node {
	t.Helper()
	var a workflow.AgentNode
	a.Id = id
	a.Arguments.Model = pointer.Ptr(model)
	var n workflow.Node
	require.NoError(t, n.FromAgentNode(a))
	return n
}

// chatClient builds an llmproxy.Client serving exactly the given chat model ids.
func chatClient(modelIDs ...string) *llmproxy.Client {
	if len(modelIDs) == 0 {
		return llmproxy.NewClient(nil)
	}
	eps := make([]selfhosted.ModelEndpoint, 0, len(modelIDs))
	for _, id := range modelIDs {
		eps = append(eps, selfhosted.ModelEndpoint{
			URL:          "http://x:8000",
			ID:           llmproxy.ModelID(id),
			Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat},
		})
	}
	return llmproxy.NewClient([]llmproxy.Provider{selfhosted.NewProvider(selfhosted.Config{Endpoints: eps})})
}

func selfHosted(url string) engine.LLMProviderConfig {
	return engine.LLMProviderConfig{Kind: engine.LLMSelfHosted, URL: url}
}

func TestBuildProviders_ResolvesChatModel(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "my-llama", llmapi.Chat)}}
	dm := engine.ResourceMapping{"my-llama": {Ref: "prov-1"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"prov-1": {Kind: engine.LLMSelfHosted, URL: "http://llm:8000", APIKey: "k"},
	}}

	provs, err := buildProviders(wf, dm, ext, nil)
	require.NoError(t, err)
	require.Len(t, provs, 1)
	providerID := provs[0].ProviderID()

	models := provs[0].AvailableModels()
	require.Len(t, models, 1)
	assert.Equal(t, llmproxy.ModelID("my-llama"), models[0].ID)
	assert.Equal(t, providerID, models[0].Provider, "model must route to its provider")
}

func TestBuildProviders_UnboundModelFails(t *testing.T) {
	// Declared models are always custom — an unbound one is a broken config.
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "my-llama", llmapi.Chat)}}
	_, err := buildProviders(wf, nil, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not bound")
}

func TestBuildProviders_NoModels(t *testing.T) {
	provs, err := buildProviders(&workflow.Workflow{}, nil, nil, nil)
	require.NoError(t, err)
	assert.Nil(t, provs)
}

func TestBuildProviders_BoundButNoConfig(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "m", llmapi.Chat)}}
	dm := engine.ResourceMapping{"m": {Ref: "missing"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{}}

	_, err := buildProviders(wf, dm, ext, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no provider config")
}

func TestBuildProviders_DeclaredModelOnNonSelfHostedFails(t *testing.T) {
	// A declared (custom) model must bind to a self-hosted provider, not a catalog one.
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "m", llmapi.Chat)}}
	dm := engine.ResourceMapping{"m": {Ref: "p"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"p": {Kind: engine.LLMLocal, Provider: "Anthropic"},
	}}

	_, err := buildProviders(wf, dm, ext, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "self-hosted")
}

func TestBuildProviders_EmbeddingUnsupported(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "embed", llmapi.Embedding)}}
	dm := engine.ResourceMapping{"embed": {Ref: "p"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{"p": selfHosted("http://e:8000")}}

	_, err := buildProviders(wf, dm, ext, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "embedding")
}

func TestBuildProviders_MultipleModelsOneProvider(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{
		llmModel(t, "a", llmapi.Chat),
		llmModel(t, "b", llmapi.Chat),
	}}
	dm := engine.ResourceMapping{"a": {Ref: "p1"}, "b": {Ref: "p2"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"p1": selfHosted("http://a:8000"),
		"p2": selfHosted("http://b:8000"),
	}}

	provs, err := buildProviders(wf, dm, ext, nil)
	require.NoError(t, err)
	require.Len(t, provs, 1, "all custom models are served by one self-hosted provider")
	assert.Len(t, provs[0].AvailableModels(), 2)
}

func TestBuildProviders_LocalCatalogProvider(t *testing.T) {
	// A localLlm instance builds the named catalog adapter; no declared model,
	// no mapping — the adapter's static catalog models route by id.
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"anthropic": {Kind: engine.LLMLocal, Provider: "Anthropic", APIKey: "sk-ant"},
	}}

	provs, err := buildProviders(&workflow.Workflow{}, nil, ext, nil)
	require.NoError(t, err)
	require.Len(t, provs, 1)
	assert.Equal(t, llmproxy.ProviderID("Anthropic"), provs[0].ProviderID())
	assert.NotEmpty(t, provs[0].AvailableModels(), "adapter serves its static catalog")
}

func TestBuildProviders_UnknownLocalProviderFails(t *testing.T) {
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"x": {Kind: engine.LLMLocal, Provider: "Bogus", APIKey: "k"},
	}}
	_, err := buildProviders(&workflow.Workflow{}, nil, ext, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown catalog provider")
}

func TestBuildProviders_BackendWithoutClientFails(t *testing.T) {
	// backendLlm needs a backend client; standalone (nil) is a config error.
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"anthropic": {Kind: engine.LLMBackend, Provider: "Anthropic"},
	}}
	_, err := buildProviders(&workflow.Workflow{}, nil, ext, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no backend is configured")
}

func TestRequiredModelIDs_ScansAgentsAndFunctionsDeduped(t *testing.T) {
	wf := &workflow.Workflow{
		Nodes: []workflow.Node{agentNode(t, "a1", "gpt-4o"), agentNode(t, "a2", "gpt-4o")},
		Functions: []workflow.Function{
			{Nodes: []workflow.Node{agentNode(t, "f1", "claude")}},
		},
	}
	ids, err := requiredModelIDs(wf)
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"gpt-4o", "claude"}, ids)
}

func TestRequiredModelIDs_IgnoresNonAgentAndMissingModel(t *testing.T) {
	var noModel workflow.AgentNode
	noModel.Id = "a-empty" // Model left nil
	var n workflow.Node
	require.NoError(t, n.FromAgentNode(noModel))

	wf := &workflow.Workflow{Nodes: []workflow.Node{n}}
	ids, err := requiredModelIDs(wf)
	require.NoError(t, err)
	assert.Empty(t, ids)
}

func TestValidateModelsResolvable_AllResolvable(t *testing.T) {
	wf := &workflow.Workflow{Nodes: []workflow.Node{agentNode(t, "a", "known")}}
	assert.NoError(t, validateModelsResolvable(wf, chatClient("known")))
}

func TestValidateModelsResolvable_UnresolvableFails(t *testing.T) {
	wf := &workflow.Workflow{Nodes: []workflow.Node{agentNode(t, "a", "ghost")}}
	err := validateModelsResolvable(wf, chatClient("known"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ghost")
}

func TestValidateModelsResolvable_NoAgentsPasses(t *testing.T) {
	assert.NoError(t, validateModelsResolvable(&workflow.Workflow{}, chatClient()))
}
