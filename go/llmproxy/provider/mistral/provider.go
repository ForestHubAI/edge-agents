// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package mistral implements the Mistral LLM provider.
package mistral

import (
	"context"
	"fmt"
	"net/http"

	"github.com/ForestHubAI/edge-agents/go/util/httpclient"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"
)

const ProviderID llmproxy.ProviderID = "Mistral"

// availableModels is the canonical list of Mistral models exposed by this provider.
var availableModels = []llmproxy.ModelInfo{
	{ID: "mistral-large-latest", Label: "Mistral Large", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "mistral-medium-latest", Label: "Mistral Medium", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "mistral-small-latest", Label: "Mistral Small", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "ministral-8b-latest", Label: "Ministral 8B", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "ministral-3b-latest", Label: "Ministral 3B", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "pixtral-large-latest", Label: "Pixtral Large", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "codestral-latest", Label: "Codestral", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "mistral-embed", Label: "Mistral Embed", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityEmbedding}, TokenModifier: 1.0, EmbeddingDimension: pointer.Ptr(1024)},
}

// Provider implements Provider for Mistral
type Provider struct {
	httpClient *httpclient.Client
}

// NewProvider creates a new Mistral Provider
func NewProvider(cfg Config) *Provider {
	return &Provider{
		httpClient: httpclient.NewClient("https://api.mistral.ai", "Authorization", "Bearer "+cfg.APIKey),
	}
}

// ProviderID returns the unique identifier of the LLM provider.
func (p *Provider) ProviderID() llmproxy.ProviderID {
	return ProviderID
}

// Health pings Mistral to ensure connectivity
func (p *Provider) Health(ctx context.Context) error {
	// Try listing models as a lightweight ping
	res := ModelList{}
	err := p.httpClient.Do(ctx, "GET", "/v1/models", nil, nil, &res)
	if err != nil {
		return fmt.Errorf("health check failed: %w", err)
	}
	return nil
}

// AvailableModels returns the static list of Mistral models exposed by this provider.
func (p *Provider) AvailableModels() []llmproxy.ModelInfo {
	return availableModels
}

// Chat sends a text prompt to Mistral and returns the generated response.
func (p *Provider) Chat(ctx context.Context, request *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error) {
	// Throw error if user tried to upload files by ID, as it is not supported
	if len(request.FileIDs) > 0 || len(request.ImageIDs) > 0 || len(request.ImageURLs) > 0 {
		return nil, fmt.Errorf("referencing files in chat not supported by Mistral: %w", provider.ErrNotSupported)
	}
	req, err := toMistralRequest(request)
	if err != nil {
		return nil, fmt.Errorf("failed to convert request to Mistral format: %w", err)
	}
	resp := ChatCompletionResponse{}

	err = p.httpClient.Do(ctx, "POST", "/v1/chat/completions", nil, req, &resp)
	if err != nil {
		return nil, fmt.Errorf("failed to get response from Mistral API: %w", err)
	}

	// Process output
	choice := resp.Choices[0]
	answer, err := extractAnswer(&choice)
	if err != nil {
		return nil, fmt.Errorf("failed to extract answer: %w", err)
	}
	toolCallRequests, err := extractToolCalls(&choice)
	if err != nil {
		return nil, fmt.Errorf("failed to extract tool calls: %w", err)
	}

	// Validate output and return
	var incompleteErr error
	if resp.Choices[0].FinishReason != "stop" && resp.Choices[0].FinishReason != "tool_calls" {
		incompleteErr = fmt.Errorf("%w: %s", provider.ErrIncompleteResponse, resp.Choices[0].FinishReason)
	}
	return &llmproxy.ChatResponse{
		Text:             answer,
		ToolCallRequests: toolCallRequests,
		ResponseID:       resp.Id,
		TokensUsed:       resp.Usage.TotalTokens,
		InputTokens:      resp.Usage.PromptTokens,
		OutputTokens:     resp.Usage.CompletionTokens,
	}, incompleteErr
}

// UploadFile uploads a file to Mistral
func (p *Provider) UploadFile(ctx context.Context, request *llmproxy.FileUploadRequest) (*llmproxy.FileUploadResponse, error) {
	// Prepare form parts
	parts := []httpclient.FormPart{
		&httpclient.File{
			Name:     "file",
			FileName: request.FileName,
			Reader:   request.File,
		},
		&httpclient.Field{
			Name:  "purpose",
			Value: request.Purpose,
		},
	}

	// Do the request
	var res UploadFileOut
	err := p.httpClient.Do(ctx, http.MethodPost, "/v1/files", nil, parts, &res)
	if err != nil {
		return nil, fmt.Errorf("failed to upload file: %w", err)
	}

	return &llmproxy.FileUploadResponse{
		FileID:   llmproxy.FileID(res.Id.String()),
		FileName: res.Filename,
	}, nil
}

// DeleteFile removes a previously uploaded file from Mistral
func (p *Provider) DeleteFile(ctx context.Context, fileID llmproxy.FileID) (bool, error) {
	var res DeleteFileOut
	err := p.httpClient.Do(ctx, "DELETE", fmt.Sprintf("/v1/files/%s", fileID), nil, nil, &res)
	if err != nil {
		return false, fmt.Errorf("failed to delete file from Mistral API: %w", err)
	}
	return res.Deleted, nil
}

// Embed generates embeddings for the given inputs using a Mistral embedding model.
func (p *Provider) Embed(ctx context.Context, req *llmproxy.EmbeddingRequest) (*llmproxy.EmbeddingResponse, error) {
	if _, err := p.EmbeddingDimension(req.Model); err != nil {
		return nil, err
	}

	var input EmbeddingRequest_Input
	if err := input.FromEmbeddingRequestInput1(req.Inputs); err != nil {
		return nil, fmt.Errorf("failed to create embedding input: %w", err)
	}

	mistralReq := EmbeddingRequest{
		Model: string(req.Model),
		Input: input,
	}

	var resp EmbeddingResponse
	if err := p.httpClient.Do(ctx, http.MethodPost, "/v1/embeddings", nil, mistralReq, &resp); err != nil {
		return nil, fmt.Errorf("failed to create embeddings: %w", err)
	}

	embeddings := make([][]float32, len(resp.Data))
	for i, d := range resp.Data {
		if d.Embedding != nil {
			embeddings[i] = *d.Embedding
		}
	}

	return &llmproxy.EmbeddingResponse{
		Embeddings:  embeddings,
		Model:       resp.Model,
		TokensUsed:  resp.Usage.TotalTokens,
		InputTokens: resp.Usage.TotalTokens,
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
