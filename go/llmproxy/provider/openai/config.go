// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package openai

// Config holds OpenAI-specific provider configuration. APIKey is env-parsed;
// InternalTools is programmatic (defaults or operator overrides).
type Config struct {
	APIKey string `env:"OPENAI_API_KEY"`

	// InternalTools governs whether and how native provider-side tools fire when
	// the corresponding marker tool is included in a ChatRequest.
	InternalTools InternalTools
}

// InternalTools groups OpenAI-side native tool configurations.
type InternalTools struct {
	// WebSearch enables OpenAI's native web_search tool when non-nil and a
	// llmproxy.WebSearch marker is present in the request. nil means
	// "native search disabled even if the marker is passed."
	WebSearch *WebSearchConfig
}

// SearchContextSize controls how much context OpenAI's native web search returns.
type SearchContextSize string

const (
	SearchContextSizeLow    SearchContextSize = "low"
	SearchContextSizeMedium SearchContextSize = "medium"
	SearchContextSizeHigh   SearchContextSize = "high"
)

// WebSearchConfig configures OpenAI's native web_search tool.
type WebSearchConfig struct {
	// ContextSize controls how much search context is returned. Empty defaults to low.
	ContextSize SearchContextSize
}
