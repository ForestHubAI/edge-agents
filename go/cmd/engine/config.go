package main

import (
	llmcfg "github.com/ForestHubAI/edge-agents/go/llmproxy/config"

	"github.com/caarlos0/env/v9"
)

// Config holds engine boot configuration. All values come from env vars
type Config struct {
	// ListenAddr is the local bind address for the engine's HTTP server
	ListenAddr string `env:"ENGINE_ADDR" envDefault:":8081"`
	// PublicAddress is the externally reachable URL the backend uses to call this engine
	PublicAddress string `env:"ENGINE_PUBLIC_ADDRESS"`
	// BackendURL is the URL of the backend to call home to and push logs to
	BackendURL string `env:"FH_BACKEND_URL"`
	// ID identifies this engine to hosted-MQTT brokers, acting as 'username'
	ID string `env:"ENGINE_ID"`
	// Secret is the shared secret for authenticating this engine with the backend and brokers
	Secret string `env:"ENGINE_SECRET"`
	// DeviceManifestFile is the path to a JSON file describing this engine's physical device and its drivers
	DeviceManifestFile string `env:"ENGINE_DEVICE_MANIFEST_FILE"`
	// ExternalResourcesFile is the optional path to the deploy's resolved external-resource configs (wire shape) the engine reads on boot. When set and the file exists, the engine starts its workflow with transports already established; absent or missing, the engine waits for them to arrive with the first /deploy push.
	ExternalResourcesFile string `env:"ENGINE_EXTERNAL_RESOURCES_FILE"`
	// DeploymentMappingFile is the optional path to the deploy mapping that binds the file-mounted workflow's logical resource ids (channels/memory/models) to this environment. Required alongside WorkflowFile whenever the workflow declares hardware or MQTT channels, since the workflow itself is binding-free.
	DeploymentMappingFile string `env:"ENGINE_DEPLOYMENT_MAPPING_FILE"`
	// WorkflowFile is the optional path used to mount a workflow directly on engine start, skipping the need for a deploy API call.
	WorkflowFile string `env:"ENGINE_CONFIG_FILE"`
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
