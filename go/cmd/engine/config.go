package main

import (
	llmcfg "github.com/ForestHubAI/edge-agents/go/llmproxy/config"

	"github.com/caarlos0/env/v9"
)

// Config holds engine boot configuration. All values come from env vars
type Config struct {
	// ConfigFile is the path to the engine's single boot config file. The engine is immutable and reads it once at startup; this is the only way config is supplied.
	ConfigFile string `env:"ENGINE_CONFIG_FILE"`
	// ID identifies this engine to hosted-MQTT brokers, acting as 'username'
	ID string `env:"ENGINE_ID"`
	// Secret is the shared secret for authenticating this engine with the backend and brokers
	Secret string `env:"ENGINE_SECRET"`
	// ResourceSecrets is the raw JSON for FH_RESOURCE_SECRETS: a map of external-
	// resource id -> {password, apiKey}, delivered out-of-band (never in the
	// deployment spec, so it stays rotation-safe and breach-safe) and merged into
	// the matching connection at boot. Empty when no external resource needs a credential.
	ResourceSecrets string `env:"FH_RESOURCE_SECRETS"`
	// BackendURL is the URL of the backend to push logs to and sync memory with
	BackendURL string `env:"FH_BACKEND_URL"`
	// LogLevel is the zerolog level name (debug/info/warn/error). Empty and
	// unknown values fall back to info via logging.ParseLevel.
	LogLevel string `env:"ENGINE_LOG_LEVEL"`
	// MemoryDir is the local working-copy directory for memory files. The
	// backend remains the durable source of truth; this is just a
	// container-local cache.
	MemoryDir string `env:"ENGINE_MEMORY_DIR" envDefault:"/var/lib/foresthub/memory"`
	// LLM holds direct provider API keys
	LLM llmcfg.ProviderConfig
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

// LoadConfig parses Config from the process environment, fataling on any
// parse error.
func LoadConfig() (*Config, error) {
	cfg := Config{}
	err := env.Parse(&cfg)
	if err != nil {
		return nil, err
	}
	return &cfg, nil
}
