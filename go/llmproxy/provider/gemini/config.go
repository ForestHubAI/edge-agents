// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package gemini

// Config holds Gemini-specific provider configuration. Either APIKey (for the
// public Gemini API) or VertexAI fields must be populated; if both are set,
// Vertex AI takes precedence in the registry wiring.
type Config struct {
	APIKey string `env:"GEMINI_API_KEY"`

	// VertexAI holds GCP project + location for Vertex AI backend. If both fields
	// are set, the registry constructs a Vertex AI client and ignores APIKey.
	VertexAI VertexAIConfig

	// InternalTools governs whether and how native provider-side tools fire when
	// the corresponding marker tool is included in a ChatRequest.
	InternalTools InternalTools
}

// VertexAIConfig holds GCP coordinates for the Vertex AI Gemini backend.
type VertexAIConfig struct {
	Project  string `env:"GCP_PROJECT"`
	Location string `env:"GCP_LOCATION"`
}

// InternalTools groups Gemini-side native tool configurations.
type InternalTools struct {
	// WebSearch enables Gemini's native Google Search grounding when non-nil and
	// a llmproxy.WebSearch marker is present in the request. nil means "native
	// search disabled even if the marker is passed."
	WebSearch *WebSearchConfig
}

// WebSearchConfig configures Gemini's native Google Search grounding.
// Most fields are Vertex AI-only; the Gemini API backend silently ignores them.
type WebSearchConfig struct {
	// ExcludeDomains excludes results from these domains (Vertex AI only).
	ExcludeDomains []string
}
