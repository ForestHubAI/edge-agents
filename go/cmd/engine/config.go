// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/ForestHubAI/edge-agents/go/util/envconfig"
)

// Config holds engine boot configuration. All values come from env vars. The
// fixed in-container paths (boot config file, workspace) are not here — they are
// contract constants in package component, not per-deployment config.
type Config struct {
	// ID identifies this engine to hosted-MQTT brokers, acting as 'username'
	ID string `env:"ENGINE_ID"`
	// Secret is the shared secret for authenticating this engine with the backend and brokers
	Secret string `env:"ENGINE_SECRET"`
	// BackendURL is the URL of the backend the engine syncs memory with and routes
	// LLM/RAG ports through. NOT the log destination — log shipping is a separate,
	// backend-agnostic sink (see Log / FH_LOG_HTTP_URL).
	BackendURL string `env:"FH_BACKEND_URL"`
	// Log configures the shared logger's sinks (stdout always; opt-in rotating
	// file + HTTP shipper) via FH_LOG_* env vars. env.Parse recurses in; main sets
	// Log.Component to "engine" in code before wiring.
	Log logging.Config
	// WebSearch configures the optional WebSearchTool node. Leaving APIKey empty
	// disables the tool; workflows that include a WebSearchTool will fail to deploy.
	WebSearch WebSearchConfig
}

// WebSearchConfig configures the engine-wide web search provider used by
// WebSearchTool nodes. Provider defaults to "brave"; APIKey is required when
// any workflow includes a WebSearchTool.
type WebSearchConfig struct {
	Provider string `env:"ENGINE_WEB_SEARCH_PROVIDER" envDefault:"brave"`
	APIKey   string `env:"ENGINE_WEB_SEARCH_API_KEY"`
}

// LoadConfig parses Config from the process environment.
func LoadConfig() (Config, error) {
	return envconfig.Load[Config]()
}
