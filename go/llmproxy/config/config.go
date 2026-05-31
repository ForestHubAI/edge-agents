package config

import (
	"time"

	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/anthropic"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/gemini"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/mistral"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/openai"

	"github.com/caarlos0/env/v9"
	"github.com/rs/zerolog/log"
)

// ProviderConfig holds the API keys for different LLM providers
type ProviderConfig struct {
	OpenAI    openai.Config
	Mistral   mistral.Config
	Gemini    gemini.Config
	Anthropic anthropic.Config

	// SelfHosted points to a YAML file describing locally-hosted endpoints.
	// nil = self-hosted provider disabled.
	SelfHosted *string `env:"SELFHOSTED_CONFIG_FILE"`
}

type EmbeddingConfig struct {
	BatchSize      int           `env:"EMBEDDING_BATCH_SIZE" envDefault:"20"`
	MaxConcurrent  int           `env:"EMBEDDING_MAX_CONCURRENT" envDefault:"1"`
	MaxPerAccount  int           `env:"EMBEDDING_MAX_PER_ACCOUNT" envDefault:"3"`
	BatchTimeout   time.Duration `env:"EMBEDDING_BATCH_TIMEOUT" envDefault:"30s"`
	QueryTimeout   time.Duration `env:"EMBEDDING_QUERY_TIMEOUT" envDefault:"30s"`
	ExtractTimeout time.Duration `env:"EMBEDDING_EXTRACT_TIMEOUT" envDefault:"5m"`
}

// NewConfig creates a new configuration instance of the specified type
// T is a generic type that allows creating configurations for different structs
func NewConfig[T any]() *T {
	var cfg T
	err := env.Parse(&cfg)
	if err != nil {
		log.Fatal().Msgf("configuration failed, %v", err)
		return nil
	}
	return &cfg
}
