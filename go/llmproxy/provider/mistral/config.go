package mistral

// Config holds Mistral-specific provider configuration. Mistral has no
// supported native server tools at this layer, so this struct is API-key only.
type Config struct {
	APIKey string `env:"MISTRAL_API_KEY"`
}
