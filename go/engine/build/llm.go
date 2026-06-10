package build

import (
	"fmt"
	"slices"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/selfhosted"
	"github.com/ForestHubAI/edge-agents/go/mapping"
)

// buildDeployProviders resolves a workflow's declared models into a single
// per-deploy self-hosted provider. Every entry in wf.Models is a custom/
// self-hosted model while catalog models are referenced by id and never declared.
// An unbound or unconfigured model is a deploy error.
func buildDeployProviders(wf *workflow.Workflow, dm engine.DeploymentMapping, ext *engine.ExternalResources) ([]llmproxy.Provider, error) {
	endpoints := make([]selfhosted.ModelEndpoint, 0, len(wf.Models))
	for _, mu := range wf.Models {
		m, err := mu.AsLLMModel()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		b, ok := dm[m.Id]
		if !ok || b.Ref == "" {
			return nil, fmt.Errorf("model %q: declared but not bound by the deployment mapping", m.Id)
		}
		var cfg engine.LLMProviderConfig
		if ext != nil {
			cfg, ok = ext.Providers[b.Ref]
		}
		if !ok {
			return nil, fmt.Errorf("model %q: bound to %q but no provider config in deploy externalResources", m.Id, b.Ref)
		}
		if cfg.Model != "" && cfg.Model != m.Id {
			return nil, fmt.Errorf("model %q: upstream model-name aliasing (%q) is not supported yet", m.Id, cfg.Model)
		}
		caps := mapping.ModelCapabilitiesToDomain(m.Capabilities)
		if slices.Contains(caps, llmproxy.CapabilityEmbedding) {
			return nil, fmt.Errorf("model %q: the embedding capability is not supported for self-hosted deploy providers yet (no dimension in the workflow declaration)", m.Id)
		}
		endpoints = append(endpoints, selfhosted.ModelEndpoint{
			URL:          cfg.URL,
			APIKey:       cfg.APIKey,
			ID:           llmproxy.ModelID(m.Id),
			Label:        m.Label,
			Capabilities: caps,
		})
	}

	// No declared custom models → no deploy provider. Returning a slice here
	// would wrap NewProvider's nil (it returns nil for an empty config) and
	// panic NewClient on ProviderID().
	if len(endpoints) == 0 {
		return nil, nil
	}
	return []llmproxy.Provider{selfhosted.NewProvider(selfhosted.Config{Endpoints: endpoints})}, nil
}

// requiredModelIDs collects the chat-model ids referenced by Agent nodes across
// the main graph and every function body — the models the deploy must be able
// to serve. Only Agent nodes reference chat models today; nodes with a missing
// model id are skipped here (the graph build reports that as a MissingField).
func requiredModelIDs(wf *workflow.Workflow) ([]string, error) {
	seen := make(map[string]struct{})
	var out []string
	scan := func(nodes []workflow.Node) error {
		for _, n := range nodes {
			v, err := n.ValueByDiscriminator()
			if err != nil {
				return err
			}
			a, ok := v.(workflow.AgentNode)
			if !ok || a.Arguments.Model == nil || *a.Arguments.Model == "" {
				continue
			}
			id := *a.Arguments.Model
			if _, dup := seen[id]; dup {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
		return nil
	}
	if err := scan(wf.Nodes); err != nil {
		return nil, err
	}
	for _, f := range wf.Functions {
		if err := scan(f.Nodes); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// validateModelsResolvable fails the build when an Agent node references a model
// that no provider in the composed client can serve. Without this the failure
// surfaces lazily at the first Chat ("no suitable provider"); here it's a clear
// deploy-time error naming the model.
func validateModelsResolvable(wf *workflow.Workflow, client *llmproxy.Client) error {
	ids, err := requiredModelIDs(wf)
	if err != nil {
		return fmt.Errorf("scanning referenced models: %w", err)
	}
	available := make(map[string]struct{})
	for _, m := range client.AvailableModels() {
		available[string(m.ID)] = struct{}{}
	}
	for _, id := range ids {
		if _, ok := available[id]; !ok {
			return fmt.Errorf("model %q is referenced by an agent node but no configured provider serves it (no local API key, backend route, or declared custom model)", id)
		}
	}
	return nil
}
