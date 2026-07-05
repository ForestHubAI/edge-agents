// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package gemini implements the Gemini LLM provider using the Google genai SDK.
package gemini

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"

	"google.golang.org/genai"
)

const ProviderID llmproxy.ProviderID = "Gemini"

// availableModels is the canonical list of Gemini models exposed by this provider.
var availableModels = []llmproxy.ModelInfo{
	{ID: "gemini-2.5-flash", Label: "Gemini 2.5 Flash", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "gemini-2.5-flash-lite", Label: "Gemini 2.5 Flash Lite", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat}, TokenModifier: 1.0},
	{ID: "gemini-embedding-001", Label: "Gemini Embedding 001", Provider: ProviderID, Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityEmbedding}, TokenModifier: 1.0, EmbeddingDimension: pointer.Ptr(3072)},
}

// Provider implements the provider and Embedder interfaces for Google Gemini.
type Provider struct {
	client     *genai.Client
	cfg        Config
	isVertexAI bool
}

// NewVertexAIProvider creates a new Gemini Provider using the Vertex AI backend.
// The Vertex coordinates are read from cfg.VertexAI.
func NewVertexAIProvider(cfg Config) (*Provider, error) {
	clientCfg := &genai.ClientConfig{
		Backend:  genai.BackendVertexAI,
		Project:  cfg.VertexAI.Project,
		Location: cfg.VertexAI.Location,
	}
	client, err := genai.NewClient(context.Background(), clientCfg)
	if err != nil {
		return nil, fmt.Errorf("creating vertex ai client: %w", err)
	}
	return &Provider{client: client, cfg: cfg, isVertexAI: true}, nil
}

// NewAPIProvider creates a new Gemini Provider using the Gemini API backend.
func NewAPIProvider(cfg Config) (*Provider, error) {
	clientCfg := &genai.ClientConfig{
		Backend: genai.BackendGeminiAPI,
		APIKey:  cfg.APIKey,
	}
	client, err := genai.NewClient(context.Background(), clientCfg)
	if err != nil {
		return nil, fmt.Errorf("creating gemini client: %w", err)
	}
	return &Provider{client: client, cfg: cfg, isVertexAI: false}, nil
}

// ProviderID returns the unique identifier of the LLM provider.
func (p *Provider) ProviderID() llmproxy.ProviderID {
	return ProviderID
}

// AvailableModels returns the static list of Anthropic models exposed by this provider.
func (p *Provider) AvailableModels() []llmproxy.ModelInfo {
	return availableModels
}

// Health pings Gemini to ensure connectivity.
func (p *Provider) Health(ctx context.Context) error {
	_, err := p.client.Models.Get(ctx, "gemini-2.5-flash", nil)
	if err != nil {
		return fmt.Errorf("gemini health check failed: %w", err)
	}
	return nil
}

// Chat sends a prompt to Gemini and returns the response.
func (p *Provider) Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error) {
	contents, config, err := toGeminiRequest(req, p.cfg)
	if err != nil {
		return nil, fmt.Errorf("failed to create Gemini request: %w", err)
	}

	// Resolve and attach file/image references
	fileParts, err := p.resolveFileParts(ctx, req)
	if err != nil {
		return nil, err
	}
	if len(fileParts) > 0 {
		contents = append(contents, &genai.Content{
			Role:  "user",
			Parts: fileParts,
		})
	}

	resp, err := p.client.Models.GenerateContent(ctx, string(req.Model), contents, config)
	if err != nil {
		return nil, fmt.Errorf("failed to generate content: %w", err)
	}

	return fromGeminiResponse(resp)
}

// resolveFileParts resolves FileIDs, ImageIDs and ImageURLs into Gemini Part objects.
func (p *Provider) resolveFileParts(ctx context.Context, req *llmproxy.ChatRequest) ([]*genai.Part, error) {
	var parts []*genai.Part

	for _, fileID := range req.FileIDs {
		file, err := p.client.Files.Get(ctx, string(fileID), nil)
		if err != nil {
			return nil, fmt.Errorf("resolving file %s: %w", fileID, err)
		}
		parts = append(parts, genai.NewPartFromURI(file.URI, file.MIMEType))
	}

	for _, imageID := range req.ImageIDs {
		file, err := p.client.Files.Get(ctx, string(imageID), nil)
		if err != nil {
			return nil, fmt.Errorf("resolving image %s: %w", imageID, err)
		}
		parts = append(parts, genai.NewPartFromURI(file.URI, file.MIMEType))
	}

	for _, url := range req.ImageURLs {
		parts = append(parts, genai.NewPartFromURI(url, ""))
	}

	return parts, nil
}

// UploadFile uploads a file to Gemini. Not supported in Vertex AI mode.
func (p *Provider) UploadFile(ctx context.Context, req *llmproxy.FileUploadRequest) (*llmproxy.FileUploadResponse, error) {
	if p.isVertexAI {
		return nil, fmt.Errorf("gemini vertex AI does not support file uploads: %w", provider.ErrNotSupported)
	}
	file, err := p.client.Files.Upload(ctx, req.File, &genai.UploadFileConfig{
		MIMEType: string(req.FileType),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to upload file: %w", err)
	}
	return &llmproxy.FileUploadResponse{
		FileID:   llmproxy.FileID(file.Name),
		FileName: file.DisplayName,
	}, nil
}

// DeleteFile removes a previously uploaded file from Gemini. Not supported in Vertex AI mode.
func (p *Provider) DeleteFile(ctx context.Context, fileID llmproxy.FileID) (bool, error) {
	if p.isVertexAI {
		return false, fmt.Errorf("gemini vertex AI does not support file deletion: %w", provider.ErrNotSupported)
	}
	_, err := p.client.Files.Delete(ctx, string(fileID), nil)
	if err != nil {
		return false, fmt.Errorf("failed to delete file: %w", err)
	}
	return true, nil
}

// Embed generates embeddings for the given inputs using a Gemini embedding model.
func (p *Provider) Embed(ctx context.Context, req *llmproxy.EmbeddingRequest) (*llmproxy.EmbeddingResponse, error) {
	if _, err := p.EmbeddingDimension(req.Model); err != nil {
		return nil, err
	}

	contents := make([]*genai.Content, len(req.Inputs))
	for i, input := range req.Inputs {
		contents[i] = genai.NewContentFromText(input, "user")
	}

	result, err := p.client.Models.EmbedContent(ctx, string(req.Model), contents, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create embeddings: %w", err)
	}

	embeddings := make([][]float32, len(result.Embeddings))
	for i, emb := range result.Embeddings {
		embeddings[i] = emb.Values
	}

	// Gemini EmbedContent API does not return token usage metadata.
	return &llmproxy.EmbeddingResponse{
		Embeddings: embeddings,
		Model:      string(req.Model),
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
