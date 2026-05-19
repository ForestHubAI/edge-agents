package llmproxy

// ProviderID represents a supported LLM provider.
type ProviderID string

// ModelID represents a model ID
type ModelID string

// ModelInfo represents information about a model
type ModelInfo struct {
	ID                 ModelID
	Provider           ProviderID
	Label              string
	Capabilities       []ModelCapability
	TokenModifier      float64 // TokenModifier scales token counts for billing (1.0 = pass-through).
	MaxTokens          *int    // MaxTokens is the model's output token cap (chat models).
	EmbeddingDimension *int    // EmbeddingDimension is the output vector size (on embedding models).
}

// ModelCapability represents what a model can do
type ModelCapability string

// revive:disable
const (
	CapabilityChat           ModelCapability = "chat"
	CapabilityEmbedding      ModelCapability = "embedding"
	CapabilityFunctionCall   ModelCapability = "function_call"
	CapabilityVision         ModelCapability = "vision"
	CapabilityFineTuning     ModelCapability = "fine_tuning"
	CapabilityReasoning      ModelCapability = "reasoning"
	CapabilityClassification ModelCapability = "classification"
	CapabilityCode           ModelCapability = "code"
)

// revive:enable

// ProviderInfo describes a provider.
type ProviderInfo struct {
	ID     ProviderID
	Models []ModelInfo
}
