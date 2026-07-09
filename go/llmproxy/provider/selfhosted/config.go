// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package selfhosted

import (
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

// Config is the typed configuration for the Local provider.
// One Config describes any number of endpoints (e.g. llama-server containers),
// each hosting one model with their declared capabilities.
type Config struct {
	Endpoints []ModelEndpoint
}

// ModelEndpoint describes a single inference server URL and the model it serves.
type ModelEndpoint struct {
	URL           string
	APIKey        string
	ID            llmproxy.ModelID
	Label         string
	Capabilities  []llmproxy.ModelCapability
	Dimension     *int // Only needed for embedding models
	TokenModifier float64
}
