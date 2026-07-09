// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package config wires concrete LLM providers into an llmproxy.Client. This
// package is the only place that imports both llmproxy and provider/*; llmproxy
// itself has no knowledge of concrete provider implementations.
package config

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/anthropic"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/gemini"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/mistral"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/openai"

	"github.com/rs/zerolog/log"
)

// SetAPIKey routes a catalog provider id + key onto the matching field of the
// ProviderConfig, so a caller that holds a key for a single provider (known only
// by id) can feed Build without knowing the concrete provider set. Unknown id is
// an error.
func (c *ProviderConfig) SetAPIKey(id llmproxy.ProviderID, key string) error {
	switch id {
	case openai.ProviderID:
		c.OpenAI.APIKey = key
	case anthropic.ProviderID:
		c.Anthropic.APIKey = key
	case mistral.ProviderID:
		c.Mistral.APIKey = key
	case gemini.ProviderID:
		c.Gemini.APIKey = key
	default:
		return fmt.Errorf("unknown catalog provider %q", id)
	}
	return nil
}

// GetProviderModels returns the static model catalog the provider named by id serves,
// read as data — no provider is constructed and no key is required. The list is
// the single source of truth shared by every consumer of this library. Unknown id
// is an error.
func GetProviderModels(id llmproxy.ProviderID) ([]llmproxy.ModelInfo, error) {
	switch id {
	case openai.ProviderID:
		return openai.AvailableModels, nil
	case anthropic.ProviderID:
		return anthropic.AvailableModels, nil
	case mistral.ProviderID:
		return mistral.AvailableModels, nil
	case gemini.ProviderID:
		return gemini.AvailableModels, nil
	default:
		return nil, fmt.Errorf("unknown catalog provider %q", id)
	}
}

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

	return providers
}
