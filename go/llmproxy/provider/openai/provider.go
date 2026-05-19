// Package openai implements the OpenAI LLM provider.
package openai

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/fh-core/go/util/pointer"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
	"github.com/ForestHubAI/fh-core/go/llmproxy/provider"

	openai "github.com/openai/openai-go/v2"
	"github.com/openai/openai-go/v2/option"
)

const ProviderID llmproxy.ProviderID = "OpenAI"

// availableModels is the canonical list of OpenAI models exposed by this provider.
var availableModels = []llmproxy.ModelInfo{
	{ID: "gpt-5.4", Label: "GPT-5.4", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "gpt-5.2", Label: "GPT-5.2", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "gpt-5.1", Label: "GPT-5.1", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "gpt-5", Label: "GPT-5", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "gpt-5-mini", Label: "GPT-5 Mini", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "gpt-5-nano", Label: "GPT-5 Nano", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "gpt-4.1-nano", Label: "GPT-4.1 Nano", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "text-embedding-3-small", Label: "text-embedding-3-small (OpenAI)", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityEmbedding}, TokenModifier: 1.0, EmbeddingDimension: pointer.Ptr(1536)},
	{ID: "text-embedding-3-large", Label: "text-embedding-3-large (OpenAI)", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityEmbedding}, TokenModifier: 1.0, EmbeddingDimension: pointer.Ptr(3072)},
}

// Provider implements Provider for OpenAI
type Provider struct {
	client openai.Client
	cfg    Config
}

// NewProvider creates a new OpenAI Provider
func NewProvider(cfg Config) *Provider {
	return &Provider{
		client: openai.NewClient(option.WithAPIKey(cfg.APIKey)),
		cfg:    cfg,
	}
}

// ProviderID returns the unique identifier of the LLM provider.
func (p *Provider) ProviderID() llmproxy.ProviderID {
	return ProviderID
}

// AvailableModels returns the static list of OpenAI models exposed by this provider.
func (p *Provider) AvailableModels() []llmproxy.ModelInfo {
	return availableModels
}

// Health pings OpenAI to ensure connectivity
func (p *Provider) Health(ctx context.Context) error {
	// Try listing models as a lightweight ping
	_, err := p.client.Models.List(ctx)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	return nil
}

// Chat sends a prompt to OpenAI and returns the response
func (p *Provider) Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error) {
	params, err := toOpenAIRequest(req, p.cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create OpenAI request: %w", err)
	}

	// Send request
	resp, err := p.client.Responses.New(ctx, *params)
	if err != nil {
		return nil, fmt.Errorf("failed to generate response: %w", err)
	}
	// Process output
	answer, citations := extractTextAndCitations(resp)
	toolCallRequests := extractToolCalls(resp)
	var incompleteErr error
	if resp.IncompleteDetails.Reason != "" {
		incompleteErr = fmt.Errorf("%w: %s", provider.ErrIncompleteResponse, resp.IncompleteDetails.Reason)
	}
	return &llmproxy.ChatResponse{
		Text:             answer,
		Citations:        citations,
		ToolCallRequests: toolCallRequests,
		ResponseID:       resp.ID,
		TokensUsed:       int(resp.Usage.TotalTokens),
		InputTokens:      int(resp.Usage.InputTokens),
		OutputTokens:     int(resp.Usage.OutputTokens),
	}, incompleteErr
}

// UploadFile uploads a file to OpenAI
func (p *Provider) UploadFile(ctx context.Context, req *llmproxy.FileUploadRequest) (*llmproxy.FileUploadResponse, error) {
	fileParams := openai.FileNewParams{
		File:    openai.File(req.File, req.FileName, string(req.FileType)),
		Purpose: openai.FilePurposeUserData,
	}

	f, err := p.client.Files.New(ctx, fileParams)
	if err != nil {
		return nil, err
	}
	return &llmproxy.FileUploadResponse{FileID: llmproxy.FileID(f.ID), FileName: f.Filename}, nil
}

// DeleteFile removes a file from OpenAI
func (p *Provider) DeleteFile(ctx context.Context, fileID llmproxy.FileID) (bool, error) {
	res, err := p.client.Files.Delete(ctx, string(fileID))
	return res.Deleted, err
}

// Embed generates embeddings for the given inputs using an OpenAI embedding model.
func (p *Provider) Embed(ctx context.Context, req *llmproxy.EmbeddingRequest) (*llmproxy.EmbeddingResponse, error) {
	if _, err := p.EmbeddingDimension(req.Model); err != nil {
		return nil, err
	}

	resp, err := p.client.Embeddings.New(ctx, openai.EmbeddingNewParams{
		Model: openai.EmbeddingModel(string(req.Model)),
		Input: openai.EmbeddingNewParamsInputUnion{
			OfArrayOfStrings: req.Inputs,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("failed to create embeddings: %w", err)
	}

	embeddings := make([][]float32, len(resp.Data))
	for i, d := range resp.Data {
		embeddings[i] = make([]float32, len(d.Embedding))
		for j, v := range d.Embedding {
			embeddings[i][j] = float32(v)
		}
	}

	return &llmproxy.EmbeddingResponse{
		Embeddings:  embeddings,
		Model:       resp.Model,
		TokensUsed:  int(resp.Usage.TotalTokens),
		InputTokens: int(resp.Usage.PromptTokens),
	}, nil
}

// EmbeddingDimension returns the output dimension for the given embedding model.
func (p *Provider) EmbeddingDimension(model llmproxy.ModelID) (int, error) {
	for _, m := range availableModels {
		if m.ID == model && m.EmbeddingDimension != nil {
			return *m.EmbeddingDimension, nil
		}
	}
	return 0, fmt.Errorf("unsupported embedding model: %s", model)
}
