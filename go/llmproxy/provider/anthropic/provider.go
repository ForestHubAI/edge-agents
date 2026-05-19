// Package anthropic implements the Anthropic LLM provider using the official anthropic-sdk-go.
package anthropic

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
	"github.com/ForestHubAI/fh-core/go/llmproxy/provider"

	anthropicsdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

const (
	ProviderID       llmproxy.ProviderID = "Anthropic"
	defaultMaxTokens int64               = 4096
)

// availableModels is the canonical list of Anthropic models exposed by this provider.
var availableModels = []llmproxy.ModelInfo{
	{ID: "claude-sonnet-4-6", Label: "Claude Sonnet 4.6", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "claude-opus-4-6", Label: "Claude Opus 4.6", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "claude-haiku-4-5", Label: "Claude Haiku 4.5", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
}

// Provider implements the provider interface for Anthropic (Claude).
type Provider struct {
	client anthropicsdk.Client
	cfg    Config
}

// NewProvider creates a new Anthropic Provider. Unlike Gemini, this never fails.
func NewProvider(cfg Config) *Provider {
	return &Provider{
		client: anthropicsdk.NewClient(option.WithAPIKey(cfg.APIKey)),
		cfg:    cfg,
	}
}

// ProviderID returns the unique identifier of the LLM provider.
func (p *Provider) ProviderID() llmproxy.ProviderID {
	return ProviderID
}

// AvailableModels returns the static list of Anthropic models exposed by this provider.
func (p *Provider) AvailableModels() []llmproxy.ModelInfo {
	return availableModels
}

// Health pings Anthropic to ensure connectivity.
func (p *Provider) Health(ctx context.Context) error {
	_, err := p.client.Models.List(ctx, anthropicsdk.ModelListParams{})
	if err != nil {
		return fmt.Errorf("anthropic health check failed: %w", err)
	}
	return nil
}

// Chat sends a prompt to Anthropic and returns the response.
func (p *Provider) Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error) {
	params, err := toAnthropicRequest(req, p.cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create Anthropic request: %w", err)
	}

	// Resolve ImageURLs — append to the last user message
	if len(req.ImageURLs) > 0 {
		appendImageURLs(&params, req.ImageURLs)
	}

	// FileIDs and ImageIDs are not supported (no file upload API)
	if len(req.FileIDs) > 0 || len(req.ImageIDs) > 0 {
		return nil, fmt.Errorf("file/image IDs not supported: %w", provider.ErrNotSupported)
	}

	msg, err := p.client.Messages.New(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("failed to generate content: %w", err)
	}

	return fromAnthropicResponse(msg)
}

// appendImageURLs appends image URL blocks to the last user message in the params.
func appendImageURLs(params *anthropicsdk.MessageNewParams, urls []string) {
	var imageBlocks []anthropicsdk.ContentBlockParamUnion
	for _, url := range urls {
		imageBlocks = append(imageBlocks, anthropicsdk.NewImageBlock(anthropicsdk.URLImageSourceParam{URL: url}))
	}
	// If there are existing messages, append to the last user message
	if n := len(params.Messages); n > 0 {
		last := &params.Messages[n-1]
		if last.Role == anthropicsdk.MessageParamRoleUser {
			last.Content = append(last.Content, imageBlocks...)
			return
		}
	}
	// Otherwise create a new user message with the images
	params.Messages = append(params.Messages, anthropicsdk.NewUserMessage(imageBlocks...))
}

// UploadFile is not supported by Anthropic — files must be sent inline.
func (p *Provider) UploadFile(_ context.Context, _ *llmproxy.FileUploadRequest) (*llmproxy.FileUploadResponse, error) {
	return nil, fmt.Errorf("anthropic does not support file uploads: %w", provider.ErrNotSupported)
}

// DeleteFile is not supported by Anthropic.
func (p *Provider) DeleteFile(_ context.Context, _ llmproxy.FileID) (bool, error) {
	return false, fmt.Errorf("anthropic does not support file deletion: %w", provider.ErrNotSupported)
}
