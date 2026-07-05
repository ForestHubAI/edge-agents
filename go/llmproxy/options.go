// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package llmproxy

// Options represents model-specific options for generation.
type Options struct {
	// MaxTokens specifies the maximum number of tokens to generate in the response.
	// If nil, the model defaults to its internal maximum generation length.
	MaxTokens *int `json:"maxTokens,omitempty"`

	// Temperature controls randomness in generation.
	// Higher values (e.g., 1.0) make output more random, lower values (e.g., 0.0) make it deterministic.
	Temperature *float32 `json:"temperature,omitempty"`

	// TopK specifies the maximum number of tokens to consider during sampling.
	TopK *int `json:"topK,omitempty"`

	// TopP (nucleus sampling) controls the cumulative probability cutoff for token selection.
	// Only tokens whose cumulative probability <= TopP are considered at each step.
	TopP *float32 `json:"topP,omitempty"`

	// FrequencyPenalty reduces the likelihood of repeating tokens that have already appeared.
	// Higher values make the model less likely to repeat the same text.
	FrequencyPenalty *float32 `json:"frequencyPenalty,omitempty"`

	// PresencePenalty penalizes tokens that have already appeared in the text.
	// This encourages introducing new concepts instead of repeating old ones.
	PresencePenalty *float32 `json:"presencePenalty,omitempty"`

	// Seed sets the random seed for deterministic generation.
	// Useful for reproducibility. Nil uses a random seed.
	Seed *int `json:"seed,omitempty"`
}

// Option is a functional option for configuring generation options
type Option func(*Options)

// WithMaxTokens sets the maximum number of tokens to generate
func WithMaxTokens(n int) Option {
	return func(o *Options) { o.MaxTokens = &n }
}

// WithTemperature sets the temperature option
func WithTemperature(t float32) Option {
	return func(o *Options) { o.Temperature = &t }
}

// WithTopK sets the top_k sampling parameter
func WithTopK(k int) Option {
	return func(o *Options) { o.TopK = &k }
}

// WithTopP sets the top_p (nucleus sampling) option
func WithTopP(p float32) Option {
	return func(o *Options) { o.TopP = &p }
}

// WithFrequencyPenalty sets the frequency penalty option
func WithFrequencyPenalty(f float32) Option {
	return func(o *Options) { o.FrequencyPenalty = &f }
}

// WithPresencePenalty sets the presence penalty option
func WithPresencePenalty(f float32) Option {
	return func(o *Options) { o.PresencePenalty = &f }
}

// WithSeed sets the random seed for deterministic generation
func WithSeed(s int) Option {
	return func(o *Options) { o.Seed = &s }
}
