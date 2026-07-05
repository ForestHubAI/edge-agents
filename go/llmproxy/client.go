// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:generate go tool mockery

// Package llmproxy provides a unified client interface for interacting with multiple LLM providers.
package llmproxy

import (
	"context"
	"fmt"
)

// Client is the main entry point for interacting with multiple LLM providers.
type Client struct {
	providers map[ProviderID]Provider
	models    map[ModelID]ModelInfo // Cached model info for quick lookup
}

// NewClient creates a new client with the given set of providers.
// Providers are constructed by a registry/wiring layer and injected here; llmproxy
// itself has no knowledge of concrete provider implementations.
func NewClient(providers []Provider) *Client {
	provs := make(map[ProviderID]Provider, len(providers))
	models := make(map[ModelID]ModelInfo)
	for _, p := range providers {
		provs[p.ProviderID()] = p
		// Cache models for provider inference
		mod := p.AvailableModels()
		for _, m := range mod {
			// TODO: throw error on modelID conflict?
			models[ModelID(m.ID)] = m
		}
	}
	return &Client{providers: provs, models: models}
}

// Health verifies the health of all configured providers. It returns an error if any provider is unhealthy.
func (c *Client) Health(ctx context.Context) error {
	for pID, p := range c.providers {
		if err := p.Health(ctx); err != nil {
			return fmt.Errorf("health check failed for provider '%s': %w", pID, err)
		}
	}
	return nil
}

// AvailableProviders returns info about all configured providers.
func (c *Client) AvailableProviders() []ProviderInfo {
	var infos []ProviderInfo
	for _, p := range c.providers {
		info := ProviderInfo{ID: p.ProviderID(), Models: p.AvailableModels()}
		infos = append(infos, info)
	}
	return infos
}

// AvailableModels returns a list of all supported models by all configured providers.
func (c *Client) AvailableModels() []ModelInfo {
	models := make([]ModelInfo, 0, len(c.models))
	for _, m := range c.models {
		models = append(models, m)
	}
	return models
}

// Chat sends a text prompt to the LLM and returns the generated response.
func (c *Client) Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error) {
	pr, err := c.inferProvider(req.Model)
	if err != nil {
		return nil, err
	}
	return pr.Chat(ctx, req)
}

// UploadFile uploads a file to the LLM service.
func (c *Client) UploadFile(ctx context.Context, fileReq *FileUploadRequest) (*FileUploadResponse, error) {
	prov, ok := c.providers[fileReq.ProviderID]
	if !ok {
		return nil, fmt.Errorf("no suitable provider found for '%s'", fileReq.ProviderID)
	}
	return prov.UploadFile(ctx, fileReq)
}

// DeleteFile removes a previously uploaded file from the LLM service using its FileID.
func (c *Client) DeleteFile(ctx context.Context, delReq *FileDeleteRequest) (bool, error) {
	prov, ok := c.providers[delReq.ProviderID]
	if !ok {
		return false, fmt.Errorf("no suitable provider found for '%s'", delReq.ProviderID)
	}
	return prov.DeleteFile(ctx, delReq.FileID)
}

// Embed generates embeddings for the given inputs using the specified provider.
// The provider is resolved by model ID; if it does not support embedding, an error is returned.
func (c *Client) Embed(ctx context.Context, req *EmbeddingRequest) (*EmbeddingResponse, error) {
	pr, err := c.inferProvider(req.Model)
	if err != nil {
		return nil, err
	}
	ep, ok := pr.(Embedder)
	if !ok {
		return nil, fmt.Errorf("provider '%s' does not support embedding", pr.ProviderID())
	}
	return ep.Embed(ctx, req)
}

// EmbeddingModelInfo returns the modelInfo and embedding dimension for the given model or error
// if not an embedding model
func (c *Client) EmbeddingModel(model ModelID) (ModelInfo, int, error) {
	mi, ok := c.models[model]
	if !ok {
		return ModelInfo{}, 0, fmt.Errorf("model '%s' not found", model)
	}
	if mi.EmbeddingDimension != nil {
		return mi, *mi.EmbeddingDimension, nil
	}
	return mi, 0, fmt.Errorf("model '%s' does not support embedding", model)
}

// inferProvider selects the appropriate Provider for the given model
func (c *Client) inferProvider(model ModelID) (Provider, error) {
	mi, ok := c.models[model]
	if ok {
		prov, ok := c.providers[mi.Provider]
		if ok {
			return prov, nil
		}
	}
	return nil, fmt.Errorf("no suitable provider found for model '%s'", model)
}
