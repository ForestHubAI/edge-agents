// Package registry wires concrete LLM providers into an llmproxy.Client.
// This package is the only place that imports both llmproxy and provider/*;
// llmproxy itself has no knowledge of concrete provider implementations.
package config

import (
	"github.com/ForestHubAI/fh-core/go/llmproxy"
	"github.com/ForestHubAI/fh-core/go/llmproxy/provider/anthropic"
	"github.com/ForestHubAI/fh-core/go/llmproxy/provider/gemini"
	"github.com/ForestHubAI/fh-core/go/llmproxy/provider/mistral"
	"github.com/ForestHubAI/fh-core/go/llmproxy/provider/openai"
	"github.com/ForestHubAI/fh-core/go/llmproxy/provider/selfhosted"

	"github.com/rs/zerolog/log"
)

// Build returns the set of providers enabled by the given configuration.
// Unconfigured providers are skipped; if a provider fails to initialize, it is
// logged and omitted rather than failing the whole build.
func Build(cfg ProviderConfig) []llmproxy.Provider {
	var providers []llmproxy.Provider

	if cfg.OpenAI.APIKey != "" {
		providers = append(providers, openai.NewProvider(cfg.OpenAI))
	}
	if cfg.Mistral.APIKey != "" {
		providers = append(providers, mistral.NewProvider(cfg.Mistral))
	}
	// Gemini: Vertex AI mode takes precedence over API-key mode.
	if cfg.Gemini.VertexAI.Project != "" && cfg.Gemini.VertexAI.Location != "" {
		p, err := gemini.NewVertexAIProvider(cfg.Gemini)
		if err != nil {
			log.Error().Err(err).Msg("Failed to initialize Gemini provider with Vertex AI, skipping")
		} else {
			providers = append(providers, p)
		}
	} else if cfg.Gemini.APIKey != "" {
		p, err := gemini.NewAPIProvider(cfg.Gemini)
		if err != nil {
			log.Error().Err(err).Msg("Failed to initialize Gemini provider with API key, skipping")
		} else {
			providers = append(providers, p)
		}
	}
	if cfg.Anthropic.APIKey != "" {
		providers = append(providers, anthropic.NewProvider(cfg.Anthropic))
	}
	if cfg.SelfHosted != nil {
		shCfg, err := selfhosted.LoadConfig(*cfg.SelfHosted)
		if err != nil {
			log.Error().Err(err).Str("path", *cfg.SelfHosted).Msg("Failed to load self-hosted provider config, skipping")
		} else if p := selfhosted.NewProvider(shCfg); p != nil {
			providers = append(providers, p)
		}
	}

	return providers
}
