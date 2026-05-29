package selfhosted

import (
	"fmt"
	"os"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"gopkg.in/yaml.v3"
)

// Config is the typed configuration for the Local provider.
// One Config describes any number of endpoints (e.g. llama-server containers),
// each hosting one or more models with their declared capabilities.
type Config struct {
	Endpoints []EndpointConfig `yaml:"endpoints"`
}

// EndpointConfig describes a single inference server URL and the models it serves.
type EndpointConfig struct {
	URL    string        `yaml:"url"`
	Models []ModelConfig `yaml:"models"`
}

// ModelConfig declares one model exposed by an endpoint.
// Dimension is required when Capabilities contains CapabilityEmbedding.
type ModelConfig struct {
	ID            llmproxy.ModelID           `yaml:"id"`
	Label         string                     `yaml:"label"`
	Capabilities  []llmproxy.ModelCapability `yaml:"capabilities"`
	Dimension     *int                       `yaml:"dimension,omitempty"`
	TokenModifier float64                    `yaml:"tokenModifier,omitempty"`
}

// LoadConfig reads, parses and validates a Local provider config YAML file.
func LoadConfig(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return Config{}, fmt.Errorf("reading local config %s: %w", path, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("parsing local config %s: %w", path, err)
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, fmt.Errorf("invalid local config %s: %w", path, err)
	}
	cfg.applyDefaults()
	return cfg, nil
}

// Validate checks that the config is internally consistent and complete.
func (c Config) Validate() error {
	if len(c.Endpoints) == 0 {
		return fmt.Errorf("at least one endpoint required")
	}
	seenIDs := make(map[llmproxy.ModelID]string)
	for i, ep := range c.Endpoints {
		if !strings.HasPrefix(ep.URL, "http://") && !strings.HasPrefix(ep.URL, "https://") {
			return fmt.Errorf("endpoint[%d]: url must start with http:// or https:// (got %q)", i, ep.URL)
		}
		if len(ep.Models) == 0 {
			return fmt.Errorf("endpoint[%d] (%s): at least one model required", i, ep.URL)
		}
		for j, m := range ep.Models {
			if m.ID == "" {
				return fmt.Errorf("endpoint[%d] model[%d]: id required", i, j)
			}
			if len(m.Capabilities) == 0 {
				return fmt.Errorf("model %s: at least one capability required", m.ID)
			}
			hasEmbedding := false
			for _, cap := range m.Capabilities {
				if cap == llmproxy.CapabilityEmbedding {
					hasEmbedding = true
				}
			}
			if hasEmbedding && (m.Dimension == nil || *m.Dimension <= 0) {
				return fmt.Errorf("model %s: embedding capability requires positive dimension", m.ID)
			}
			if prev, ok := seenIDs[m.ID]; ok {
				return fmt.Errorf("model %s declared on multiple endpoints (%s and %s)", m.ID, prev, ep.URL)
			}
			seenIDs[m.ID] = ep.URL
		}
	}
	return nil
}

// applyDefaults fills zero-valued fields with sensible defaults. Run after Validate.
func (c *Config) applyDefaults() {
	for i := range c.Endpoints {
		for j := range c.Endpoints[i].Models {
			m := &c.Endpoints[i].Models[j]
			if m.TokenModifier == 0 {
				m.TokenModifier = 1.0
			}
		}
	}
}
