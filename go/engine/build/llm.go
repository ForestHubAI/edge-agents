// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"fmt"
	"slices"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/backend"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	llmcfg "github.com/ForestHubAI/edge-agents/go/llmproxy/config"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/selfhosted"
	"github.com/ForestHubAI/edge-agents/go/mapping"
)

// buildProviders resolves the boot externalResources into the set of llmproxy
// providers to register into the engine's single llmproxy client. The client
// then routes each referenced model by id — there is no pre-routing here.
//
//   - self-hosted: every declared workflow model (all customs) binds to a
//     selfhostedLlm instance; the models bound to one endpoint share the single
//     SelfHosted provider (its own id per model, url/key from the instance).
//   - local / backend: catalog provider instances declared directly in
//     externalResources (no declared model — catalog models route by id). local
//     instances are translated into an llmproxy ProviderConfig and constructed by
//     the registry (llmcfg.Build) — the engine holds no provider-construction
//     logic of its own; backend instances become stand-ins that forward to the
//     backend, claiming the same static model set the registry gives that provider.
//
// backendClient may be nil (no backend configured); a backendLlm instance then
// is a config error. An unbound or unconfigured declared model is a config error.
func buildProviders(wf *workflowapi.Workflow, rm engine.ResourceMapping, ext *engine.ExternalResources, backendClient *backend.Client) ([]llmproxy.Provider, error) {
	if ext == nil {
		ext = &engine.ExternalResources{}
	}
	var providers []llmproxy.Provider

	// Self-hosted: declared models grouped onto their bound endpoints.
	endpoints, err := selfHostedEndpoints(wf, rm, ext)
	if err != nil {
		return nil, err
	}
	// NewProvider returns nil for an empty config; a nil provider would panic
	// NewClient on ProviderID(), so only append when there are endpoints.
	if len(endpoints) > 0 {
		providers = append(providers, selfhosted.NewProvider(selfhosted.Config{Endpoints: endpoints}))
	}

	// Catalog providers (self-hosted handled above). Local instances feed one
	// ProviderConfig the registry builds; backend instances become stand-ins.
	var localCfg llmcfg.ProviderConfig
	haveLocal := false
	for ref, cfg := range ext.Providers {
		id := llmproxy.ProviderID(cfg.Provider)
		switch cfg.Kind {
		case engine.LLMSelfHosted:
			// Handled via selfHostedEndpoints.
		case engine.LLMLocal:
			if err := localCfg.SetAPIKey(id, cfg.APIKey); err != nil {
				return nil, fmt.Errorf("provider %q: %w", ref, err)
			}
			haveLocal = true
		case engine.LLMBackend:
			if backendClient == nil {
				return nil, fmt.Errorf("provider %q: backend routing requested but no backend is configured", ref)
			}
			// Models are static and library-sourced (the backend builds its
			// providers from the same catalog) — no fetch, just look them up.
			models, err := llmcfg.GetProviderModels(id)
			if err != nil {
				return nil, fmt.Errorf("provider %q: %w", ref, err)
			}
			providers = append(providers, backend.NewBackendProvider(backendClient, id, models))
		default:
			return nil, fmt.Errorf("provider %q: unknown provider kind %q", ref, cfg.Kind)
		}
	}
	if haveLocal {
		providers = append(providers, llmcfg.Build(localCfg)...)
	}

	if len(providers) == 0 {
		return nil, nil
	}
	return providers, nil
}

// selfHostedEndpoints resolves every declared workflow LLM model (all customs) to
// a self-hosted endpoint via its resource mapping and provider config. Several
// models on one endpoint become several ModelEndpoints sharing a url. wf.Models
// also holds ML models (served by an inference component, resolved separately in
// buildDeployML); those are skipped here by discriminator. A declared model bound
// to a non-self-hosted provider is a config error.
func selfHostedEndpoints(wf *workflowapi.Workflow, rm engine.ResourceMapping, ext *engine.ExternalResources) ([]selfhosted.ModelEndpoint, error) {
	endpoints := make([]selfhosted.ModelEndpoint, 0, len(wf.Models))
	claimed := make(map[string]string) // server model id → workflow model id that registered it
	for _, mu := range wf.Models {
		disc, err := mu.Discriminator()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		if disc != string(workflowapi.LLMModelTypeLLMModel) {
			continue
		}
		m, err := mu.AsLLMModel()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		b, ok := rm[m.Id]
		if !ok || b.Ref == "" {
			return nil, fmt.Errorf("model %q: declared but not bound by the resource mapping", m.Id)
		}
		cfg, ok := ext.Providers[b.Ref]
		if !ok {
			return nil, fmt.Errorf("model %q: bound to %q but no provider config in externalResources", m.Id, b.Ref)
		}
		if cfg.Kind != engine.LLMSelfHosted {
			return nil, fmt.Errorf("model %q: declared models must bind to a self-hosted provider, got %q", m.Id, cfg.Kind)
		}
		caps := mapping.ModelCapabilitiesToDomain(m.Capabilities)
		if slices.Contains(caps, llmproxy.CapabilityEmbedding) {
			return nil, fmt.Errorf("model %q: the embedding capability is not supported for self-hosted providers yet (no dimension in the workflow declaration)", m.Id)
		}
		// The provider is registered under the server's own model id (the address's
		// model sub-address, which the mapping must supply); the Agent's reference
		// is translated to it via resolveModelID, so the llmproxy never sees the
		// workflow id. The endpoint fronts several models, selected by this name.
		if b.Model == nil || *b.Model == "" {
			return nil, fmt.Errorf("model %q: mapped to %q but the address carries no model name for the self-hosted endpoint to select on", m.Id, b.Ref)
		}
		serverID := *b.Model
		if prev, dup := claimed[serverID]; dup {
			return nil, fmt.Errorf("models %q and %q both resolve to server model %q; self-hosted server model names must be unique", prev, m.Id, serverID)
		}
		claimed[serverID] = m.Id
		endpoints = append(endpoints, selfhosted.ModelEndpoint{
			ID:           llmproxy.ModelID(serverID),
			Label:        m.Label,
			URL:          cfg.URL,
			APIKey:       cfg.APIKey,
			Capabilities: caps,
		})
	}
	return endpoints, nil
}

// resolveModelID translates a workflow model id to the id its provider actually
// serves it under. A declared self-hosted model is served under its address's
// model sub-address (its mapping entry); a catalog model has no mapping entry and
// is served under its own id.
func resolveModelID(rm engine.ResourceMapping, id string) string {
	if addr, ok := rm[id]; ok && addr.Model != nil && *addr.Model != "" {
		return *addr.Model
	}
	return id
}

// validateModelsResolvable fails the build when an Agent node references a model
// that no provider in the composed client can serve. Without this the failure
// surfaces lazily at the first Chat ("no suitable provider"); here it's a clear
// boot-time error naming the model.
func validateModelsResolvable(wf *workflowapi.Workflow, rm engine.ResourceMapping, client *llmproxy.Client) error {
	ids, err := workflowapi.ReferencedModelIDs(wf)
	if err != nil {
		return fmt.Errorf("scanning referenced models: %w", err)
	}
	available := make(map[string]struct{})
	for _, m := range client.AvailableModels() {
		available[string(m.ID)] = struct{}{}
	}
	for _, id := range ids {
		// The provider serves declared models under their server id, so compare
		// against the resolved id (catalog ids resolve to themselves).
		resolved := resolveModelID(rm, id)
		if _, ok := available[resolved]; !ok {
			return fmt.Errorf("model %q is referenced by an agent node but no configured provider serves it (no local API key, backend route, or declared custom model)", id)
		}
	}
	return nil
}
