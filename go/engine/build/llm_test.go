// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/llmapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/selfhosted"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func llmModel(t *testing.T, id string, caps ...llmapi.ModelCapability) workflowapi.Model {
	t.Helper()
	var m workflowapi.Model
	require.NoError(t, m.FromLLMModel(workflowapi.LLMModel{
		Type:         workflowapi.LLMModelTypeLLMModel,
		Id:           id,
		Label:        id,
		Capabilities: caps,
	}))
	return m
}

// agentNode builds a workflow Node wrapping an Agent that references model.
func agentNode(t *testing.T, id, model string) workflowapi.Node {
	t.Helper()
	var a workflowapi.AgentNode
	a.Id = id
	a.Arguments.Model = pointer.Ptr(model)
	var n workflowapi.Node
	require.NoError(t, n.FromAgentNode(a))
	return n
}

// chatClient builds an llmproxy.Client serving exactly the given chat model ids.
func chatClient(modelIDs ...string) *llmproxy.Client {
	if len(modelIDs) == 0 {
		c, _ := llmproxy.NewClient(nil)
		return c
	}
	eps := make([]selfhosted.ModelEndpoint, 0, len(modelIDs))
	for _, id := range modelIDs {
		eps = append(eps, selfhosted.ModelEndpoint{
			URL:          "http://x:8000",
			ID:           llmproxy.ModelID(id),
			Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat},
		})
	}
	c, _ := llmproxy.NewClient([]llmproxy.Provider{selfhosted.NewProvider(selfhosted.Config{Endpoints: eps})})
	return c
}

func selfHosted(url string) engine.LLMProvider {
	return engine.LLMProvider{Kind: engine.LLMSelfHosted, URL: url}
}

func TestBuildProviders_ResolvesChatModel(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{llmModel(t, "my-llama", llmapi.Chat)}}
	// The address's model differs from the workflow id: the provider registers under
	// the server id, not the workflow id.
	dm := engine.ResourceMapping{"my-llama": {Ref: "prov-1", Model: pointer.Ptr("server-llama")}}
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{
		"prov-1": {Kind: engine.LLMSelfHosted, URL: "http://llm:8000", APIKey: "k"},
	}}

	provs, err := buildProviders(wf, dm, res, nil)
	require.NoError(t, err)
	require.Len(t, provs, 1)
	providerID := provs[0].ProviderID()

	models := provs[0].AvailableModels()
	require.Len(t, models, 1)
	assert.Equal(t, llmproxy.ModelID("server-llama"), models[0].ID, "registered under the server model id")
	assert.Equal(t, providerID, models[0].Provider, "model must route to its provider")
}

func TestBuildProviders_DuplicateServerModelFails(t *testing.T) {
	// Two workflow models resolving to the same server model id on different
	// endpoints would collide in the provider's routing map — reject at build.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{
		llmModel(t, "a", llmapi.Chat),
		llmModel(t, "b", llmapi.Chat),
	}}
	dm := engine.ResourceMapping{
		"a": {Ref: "p1", Model: pointer.Ptr("llama-3")},
		"b": {Ref: "p2", Model: pointer.Ptr("llama-3")},
	}
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{
		"p1": selfHosted("http://a:8000"),
		"p2": selfHosted("http://b:8000"),
	}}

	_, err := buildProviders(wf, dm, res, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "server model")
}

func TestBuildProviders_UnboundModelFails(t *testing.T) {
	// Declared models are always custom — an unbound one is a broken config.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{llmModel(t, "my-llama", llmapi.Chat)}}
	_, err := buildProviders(wf, nil, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not bound")
}

func TestBuildProviders_NoModels(t *testing.T) {
	provs, err := buildProviders(&workflowapi.Workflow{}, nil, nil, nil)
	require.NoError(t, err)
	assert.Nil(t, provs)
}

func TestBuildProviders_BoundButNoConfig(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{llmModel(t, "m", llmapi.Chat)}}
	dm := engine.ResourceMapping{"m": {Ref: "missing"}}
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{}}

	_, err := buildProviders(wf, dm, res, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no provider config")
}

func TestBuildProviders_DeclaredModelOnNonSelfHostedFails(t *testing.T) {
	// A declared (custom) model must bind to a self-hosted provider, not a catalog one.
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{llmModel(t, "m", llmapi.Chat)}}
	dm := engine.ResourceMapping{"m": {Ref: "p"}}
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{
		"p": {Kind: engine.LLMDirect, Provider: "Anthropic"},
	}}

	_, err := buildProviders(wf, dm, res, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "self-hosted")
}

func TestBuildProviders_EmbeddingUnsupported(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{llmModel(t, "embed", llmapi.Embedding)}}
	dm := engine.ResourceMapping{"embed": {Ref: "p"}}
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{"p": selfHosted("http://e:8000")}}

	_, err := buildProviders(wf, dm, res, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "embedding")
}

func TestBuildProviders_MultipleModelsOneProvider(t *testing.T) {
	wf := &workflowapi.Workflow{Models: []workflowapi.Model{
		llmModel(t, "a", llmapi.Chat),
		llmModel(t, "b", llmapi.Chat),
	}}
	dm := engine.ResourceMapping{"a": {Ref: "p1", Model: pointer.Ptr("a")}, "b": {Ref: "p2", Model: pointer.Ptr("b")}}
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{
		"p1": selfHosted("http://a:8000"),
		"p2": selfHosted("http://b:8000"),
	}}

	provs, err := buildProviders(wf, dm, res, nil)
	require.NoError(t, err)
	require.Len(t, provs, 1, "all custom models are served by one self-hosted provider")
	assert.Len(t, provs[0].AvailableModels(), 2)
}

func TestBuildProviders_LocalCatalogProvider(t *testing.T) {
	// A directLlm instance builds the named catalog adapter; no declared model,
	// no mapping — the adapter's static catalog models route by id.
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{
		"anthropic": {Kind: engine.LLMDirect, Provider: "Anthropic", APIKey: "sk-ant"},
	}}

	provs, err := buildProviders(&workflowapi.Workflow{}, nil, res, nil)
	require.NoError(t, err)
	require.Len(t, provs, 1)
	assert.Equal(t, llmproxy.ProviderID("Anthropic"), provs[0].ProviderID())
	assert.NotEmpty(t, provs[0].AvailableModels(), "adapter serves its static catalog")
}

func TestBuildProviders_UnknownLocalProviderFails(t *testing.T) {
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{
		"x": {Kind: engine.LLMDirect, Provider: "Bogus", APIKey: "k"},
	}}
	_, err := buildProviders(&workflowapi.Workflow{}, nil, res, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "unknown catalog provider")
}

func TestBuildProviders_BackendWithoutClientFails(t *testing.T) {
	// backendLlm needs a backend client; standalone (nil) is a config error.
	res := &engine.Resources{Providers: map[string]engine.LLMProvider{
		"anthropic": {Kind: engine.LLMBackend, Provider: "Anthropic"},
	}}
	_, err := buildProviders(&workflowapi.Workflow{}, nil, res, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no backend is configured")
}

func TestValidateModelsResolvable_AllResolvable(t *testing.T) {
	wf := &workflowapi.Workflow{Nodes: []workflowapi.Node{agentNode(t, "a", "known")}}
	assert.NoError(t, validateModelsResolvable(wf, nil, chatClient("known")))
}

func TestValidateModelsResolvable_UnresolvableFails(t *testing.T) {
	wf := &workflowapi.Workflow{Nodes: []workflowapi.Node{agentNode(t, "a", "ghost")}}
	err := validateModelsResolvable(wf, nil, chatClient("known"))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "ghost")
}

func TestValidateModelsResolvable_NoAgentsPasses(t *testing.T) {
	assert.NoError(t, validateModelsResolvable(&workflowapi.Workflow{}, nil, chatClient()))
}

func TestValidateModelsResolvable_TranslatesViaMapping(t *testing.T) {
	// The agent references the workflow id; the provider serves the server id. The
	// check must resolve through the mapping, else it falsely reports unresolvable.
	wf := &workflowapi.Workflow{Nodes: []workflowapi.Node{agentNode(t, "a", "logical")}}
	dm := engine.ResourceMapping{"logical": {Ref: "p", Model: pointer.Ptr("server-model")}}
	assert.NoError(t, validateModelsResolvable(wf, dm, chatClient("server-model")))
	// Without the mapping the workflow id doesn't match the served id.
	assert.Error(t, validateModelsResolvable(wf, nil, chatClient("server-model")))
}
