// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package backend

import (
	"context"
	"fmt"
	"net/http"

	"github.com/ForestHubAI/edge-agents/go/api/llmapi"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"
)

// llmHealth is the response shape of GET /llm/health.
type llmHealth string

// Health pings the backend's LLM service and returns nil if every
// configured provider on the backend is healthy.
func (c *Client) Health(ctx context.Context) error {
	var status llmHealth
	return c.http.Do(ctx, http.MethodGet, "/llm/health", nil, nil, &status)
}

// GetProviders fetches the list of LLM providers configured on the backend
// and the models they expose. Used by the engine to decide which upstream
// providers it can fall back to via the backend.
func (c *Client) GetProviders(ctx context.Context) ([]llmproxy.ProviderInfo, error) {
	var apiProviders []llmapi.ProviderInfo
	if err := c.http.Do(ctx, http.MethodGet, "/llm/providers", nil, nil, &apiProviders); err != nil {
		return nil, fmt.Errorf("list providers: %w", err)
	}
	return llmproxy.ProvidersToDomain(apiProviders), nil
}

// Chat forwards a chat request through the backend's /llm/generate route.
// The backend dispatches it to whichever underlying provider owns the model.
func (c *Client) Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error) {
	apiReq, err := llmproxy.ChatRequestToAPI(req)
	if err != nil {
		return nil, fmt.Errorf("encode chat request: %w", err)
	}
	var apiResp llmapi.ChatResponse
	if err := c.http.Do(ctx, http.MethodPost, "/llm/generate", nil, apiReq, &apiResp); err != nil {
		return nil, fmt.Errorf("backend chat: %w", err)
	}
	return llmproxy.ChatResponseToDomain(&apiResp), nil
}

// backendRoutedProvider satisfies llmproxy.Provider by forwarding to a
// backend.Client. Its ProviderID and AvailableModels mirror the upstream it
// stands in for, so the llmproxy.Client routes by ModelID exactly as if the
// upstream were configured locally.
type backendRoutedProvider struct {
	client *Client
	id     llmproxy.ProviderID
	models []llmproxy.ModelInfo
}

// NewBackendProvider creates a backendRoutedProvider for the given provider ID and model list.
func NewBackendProvider(c *Client, id llmproxy.ProviderID, models []llmproxy.ModelInfo) llmproxy.Provider {
	return &backendRoutedProvider{client: c, id: id, models: models}
}

func (p *backendRoutedProvider) ProviderID() llmproxy.ProviderID { return p.id }

func (p *backendRoutedProvider) AvailableModels() []llmproxy.ModelInfo { return p.models }

func (p *backendRoutedProvider) Health(ctx context.Context) error { return p.client.Health(ctx) }

// Chat forwards to the client's Chat method, which routes to the backend's /llm/generate.
func (p *backendRoutedProvider) Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error) {
	return p.client.Chat(ctx, req)
}

// UploadFile and DeleteFile are intentionally not implemented: no engine-side
// node uses them yet and the backend wire protocol for multipart proxying
// does not exist.
func (p *backendRoutedProvider) UploadFile(_ context.Context, _ *llmproxy.FileUploadRequest) (*llmproxy.FileUploadResponse, error) {
	return nil, fmt.Errorf("backend-routed provider: file upload %w", provider.ErrNotSupported)
}

func (p *backendRoutedProvider) DeleteFile(_ context.Context, _ llmproxy.FileID) (bool, error) {
	return false, fmt.Errorf("backend-routed provider: file delete %w", provider.ErrNotSupported)
}
