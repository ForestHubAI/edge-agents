package main

import (
	"context"

	"fh-backend/pkg/engine/backend"
	"fh-backend/pkg/engine/logging"

	"github.com/ForestHubAI/fh-core/go/llmproxy"

	llmcfg "github.com/ForestHubAI/fh-core/go/llmproxy/config"
)

// buildLLMProviders returns the engine's full provider set: every provider
// the engine has a local API key for, plus a backend-routed stand-in for any
// upstream the backend exposes that the engine is missing locally. Local
// providers always win — they're never replaced by the backend fallback.
//
// A nil backend client or a failed /llm/providers call yields locals-only;
// engine boot does not depend on backend reachability.
func buildLLMProviders(ctx context.Context, cfg llmcfg.ProviderConfig, c *backend.Client) []llmproxy.Provider {
	locals := llmcfg.Build(cfg)
	have := make(map[llmproxy.ProviderID]struct{}, len(locals))
	for _, p := range locals {
		have[p.ProviderID()] = struct{}{}
		logging.Logger.Info().Str("provider", string(p.ProviderID())).Msg("LLM provider: local")
	}
	if c == nil {
		return locals
	}
	// Get the backend's provider list
	remote, err := c.GetProviders(ctx)
	if err != nil {
		logging.Logger.Warn().Err(err).Msg("backend LLM fallback unavailable, using local providers only")
		return locals
	}
	// For each backend provider, if we don't have it locally, add a backend-routed stand-in.
	for _, p := range remote {
		if _, ok := have[p.ID]; ok {
			continue
		}
		locals = append(locals, backend.NewBackendProvider(c, p.ID, p.Models))
		logging.Logger.Info().Str("provider", string(p.ID)).Msg("LLM provider: backend-routed")
	}
	return locals
}
