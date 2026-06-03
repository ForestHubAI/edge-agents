package anthropic

// Config holds Anthropic-specific provider configuration. APIKey is env-parsed;
// InternalTools is programmatic (defaults or operator overrides).
type Config struct {
	APIKey string `env:"ANTHROPIC_API_KEY"`

	// InternalTools governs whether and how native provider-side tools fire when
	// the corresponding marker tool is included in a ChatRequest.
	InternalTools InternalTools
}

// InternalTools groups Anthropic-side native tool configurations.
type InternalTools struct {
	// WebSearch enables Anthropic's native web_search_20250305 tool when non-nil
	// and a llmproxy.WebSearch marker is present in the request. nil means
	// "native search disabled even if the marker is passed."
	WebSearch *WebSearchConfig
}

// WebSearchConfig configures Anthropic's native web_search tool.
type WebSearchConfig struct {
	// AllowedDomains restricts results to these domains. Mutually exclusive with BlockedDomains.
	AllowedDomains []string

	// BlockedDomains excludes results from these domains. Mutually exclusive with AllowedDomains.
	BlockedDomains []string

	// MaxUses caps the number of searches the model may issue per request. Zero = no cap.
	MaxUses int
}
