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

// ProviderConfig holds the env-delivered API keys for the catalog LLM
// providers. Structured providers (self-hosted endpoints, backend-routed
// stand-ins) are not configured here.
type ProviderConfig struct {
	OpenAI    openai.Config
	Mistral   mistral.Config
	Gemini    gemini.Config
	Anthropic anthropic.Config
}

type EmbeddingConfig struct {
	BatchSize      int           `env:"EMBEDDING_BATCH_SIZE" envDefault:"20"`
	MaxConcurrent  int           `env:"EMBEDDING_MAX_CONCURRENT" envDefault:"1"`
	MaxPerAccount  int           `env:"EMBEDDING_MAX_PER_ACCOUNT" envDefault:"3"`
	BatchTimeout   time.Duration `env:"EMBEDDING_BATCH_TIMEOUT" envDefault:"30s"`
	QueryTimeout   time.Duration `env:"EMBEDDING_QUERY_TIMEOUT" envDefault:"30s"`
	ExtractTimeout time.Duration `env:"EMBEDDING_EXTRACT_TIMEOUT" envDefault:"5m"`
}

// ResilienceConfig holds the resilience configuration parameters
// type ResilienceConfig struct {
// 	MaxRetries     int           `json:"RESILIENCE_MAX_RETRIES" default:"3"`
// 	InitialDelay   time.Duration `json:"RESILIENCE_INITIAL_DELAY" default:"1s"`
// 	MaxDelay       time.Duration `json:"RESILIENCE_MAX_DELAY" default:"30s"`
// 	Multiplier     float64       `json:"RESILIENCE_MULTIPLIER" default:"2.0"`
// 	Jitter         bool          `json:"RESILIENCE_JITTER" default:"true"`
// 	RequestTimeout time.Duration `json:"RESILIENCE_REQUEST_TIMEOUT" default:"30s"`
// 	ConnectTimeout time.Duration `json:"RESILIENCE_CONNECT_TIMEOUT" default:"10s"`
// }

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
