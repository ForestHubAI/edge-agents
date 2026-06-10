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

func TestBuildDeployProviders_ResolvesChatModel(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "my-llama", llmapi.Chat)}}
	dm := engine.DeploymentMapping{"my-llama": {Ref: "prov-1"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"prov-1": {URL: "http://llm:8000", APIKey: "k"},
	}}

	provs, err := buildDeployProviders(wf, dm, ext)
	require.NoError(t, err)
	require.Len(t, provs, 1)
	providerID := provs[0].ProviderID()

	models := provs[0].AvailableModels()
	require.Len(t, models, 1)
	assert.Equal(t, llmproxy.ModelID("my-llama"), models[0].ID)
	assert.Equal(t, providerID, models[0].Provider, "model must route to its provider")
}

func TestBuildDeployProviders_UnboundModelFails(t *testing.T) {
	// Declared models are always custom — an unbound one is a broken deploy.
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "my-llama", llmapi.Chat)}}
	_, err := buildDeployProviders(wf, nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not bound")
}

func TestBuildDeployProviders_NoModels(t *testing.T) {
	provs, err := buildDeployProviders(&workflow.Workflow{}, nil, nil)
	require.NoError(t, err)
	assert.Nil(t, provs)
}

func TestBuildDeployProviders_BoundButNoConfig(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "m", llmapi.Chat)}}
	dm := engine.DeploymentMapping{"m": {Ref: "missing"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{}}

	_, err := buildDeployProviders(wf, dm, ext)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "no provider config")
}

func TestBuildDeployProviders_EmbeddingUnsupported(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "embed", llmapi.Embedding)}}
	dm := engine.DeploymentMapping{"embed": {Ref: "p"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{"p": {URL: "http://e:8000"}}}

	_, err := buildDeployProviders(wf, dm, ext)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "embedding")
}

func TestBuildDeployProviders_UpstreamAliasRejected(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{llmModel(t, "m", llmapi.Chat)}}
	dm := engine.DeploymentMapping{"m": {Ref: "p"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"p": {URL: "http://e:8000", Model: "different-upstream"},
	}}

	_, err := buildDeployProviders(wf, dm, ext)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "aliasing")
}

func TestBuildDeployProviders_MultipleModelsOneProvider(t *testing.T) {
	wf := &workflow.Workflow{Models: []workflow.Model{
		llmModel(t, "a", llmapi.Chat),
		llmModel(t, "b", llmapi.Chat),
	}}
	dm := engine.DeploymentMapping{"a": {Ref: "p1"}, "b": {Ref: "p2"}}
	ext := &engine.ExternalResources{Providers: map[string]engine.LLMProviderConfig{
		"p1": {URL: "http://a:8000"},
		"p2": {URL: "http://b:8000"},
	}}

	provs, err := buildDeployProviders(wf, dm, ext)
	require.NoError(t, err)
	require.Len(t, provs, 1, "all custom models are served by one deploy provider")
	assert.Len(t, provs[0].AvailableModels(), 2)
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
