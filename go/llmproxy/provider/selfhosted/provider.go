// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package selfhosted

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/util/httpclient"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"

	"github.com/rs/zerolog/log"
)

const providerID llmproxy.ProviderID = "SelfHosted"

// Provider routes chat and embedding requests to operator-run inference server endpoints.
type Provider struct {
	id                 llmproxy.ProviderID
	chatEndpoints      map[llmproxy.ModelID]*httpclient.Client
	embeddingEndpoints map[llmproxy.ModelID]*httpclient.Client
	models             []llmproxy.ModelInfo
}

// NewProvider builds a Provider under the default "SelfHosted" id from a
// validated Config. Returns nil if the config has no models (defensive —
// Validate already rejects this).
func NewProvider(cfg Config) *Provider {
	chatEndpoints := make(map[llmproxy.ModelID]*httpclient.Client)
	embeddingEndpoints := make(map[llmproxy.ModelID]*httpclient.Client)
	var models []llmproxy.ModelInfo

	for _, ep := range cfg.Endpoints {
		headerName, headerValue := "", ""
		if ep.APIKey != "" {
			headerName, headerValue = "Authorization", "Bearer "+ep.APIKey
		}
		client := httpclient.NewClient(ep.URL, headerName, headerValue)

		tokenModifier := ep.TokenModifier
		if tokenModifier == 0 {
			tokenModifier = 1.0
		}
		models = append(models, llmproxy.ModelInfo{
			ID:                 ep.ID,
			Provider:           providerID,
			Label:              ep.Label,
			Capabilities:       ep.Capabilities,
			TokenModifier:      tokenModifier,
			EmbeddingDimension: ep.Dimension,
		})
		for _, cap := range ep.Capabilities {
			switch cap {
			case llmproxy.CapabilityChat:
				chatEndpoints[ep.ID] = client
			case llmproxy.CapabilityEmbedding:
				embeddingEndpoints[ep.ID] = client
			}
		}
	}

	if len(models) == 0 {
		log.Error().Msg("local provider: no models configured")
		return nil
	}
	log.Info().
		Int("chat_endpoints", len(chatEndpoints)).
		Int("embedding_endpoints", len(embeddingEndpoints)).
		Int("models", len(models)).
		Msg("local provider: registered")
	return &Provider{
		id:                 providerID,
		chatEndpoints:      chatEndpoints,
		embeddingEndpoints: embeddingEndpoints,
		models:             models,
	}
}

// ProviderID returns the unique identifier of this provider.
func (p *Provider) ProviderID() llmproxy.ProviderID {
	return p.id
}

// AvailableModels returns the static model list built at construction time.
func (p *Provider) AvailableModels() []llmproxy.ModelInfo {
	return p.models
}

// Health verifies that all configured endpoints are reachable.
func (p *Provider) Health(ctx context.Context) error {
	checked := make(map[*httpclient.Client]struct{})
	for modelID, client := range p.chatEndpoints {
		if _, done := checked[client]; done {
			continue
		}
		var res ModelList
		if err := client.Do(ctx, "GET", "/v1/models", nil, nil, &res); err != nil {
			return fmt.Errorf("health check failed for endpoint serving %s: %w", modelID, err)
		}
		checked[client] = struct{}{}
	}
	for modelID, client := range p.embeddingEndpoints {
		if _, done := checked[client]; done {
			continue
		}
		var res ModelList
		if err := client.Do(ctx, "GET", "/v1/models", nil, nil, &res); err != nil {
			return fmt.Errorf("health check failed for endpoint serving %s: %w", modelID, err)
		}
		checked[client] = struct{}{}
	}
	return nil
}

// Chat sends a chat completion request to the endpoint configured for the request's model.
func (p *Provider) Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error) {
	client, ok := p.chatEndpoints[req.Model]
	if !ok {
		return nil, fmt.Errorf("no chat endpoint configured for model '%s'", req.Model)
	}

	localReq, err := toLocalRequest(req)
	if err != nil {
		return nil, fmt.Errorf("failed to convert request: %w", err)
	}

	var localResp ChatCompletionResponse
	if err := client.Do(ctx, "POST", "/v1/chat/completions", nil, localReq, &localResp); err != nil {
		return nil, fmt.Errorf("failed to get response from local endpoint: %w", err)
	}

	if len(localResp.Choices) == 0 {
		return nil, fmt.Errorf("local endpoint returned no choices")
	}

	choice := localResp.Choices[0]

	answer := extractAnswer(&choice)
	toolCallRequests, err := extractToolCalls(&choice)
	if err != nil {
		return nil, fmt.Errorf("failed to extract tool calls: %w", err)
	}

	var incompleteErr error
	if choice.FinishReason != "stop" && choice.FinishReason != "tool_calls" {
		incompleteErr = fmt.Errorf("%w: %s", provider.ErrIncompleteResponse, choice.FinishReason)
	}

	return &llmproxy.ChatResponse{
		Text:             answer,
		ToolCallRequests: toolCallRequests,
		ResponseID:       localResp.ID,
		TokensUsed:       localResp.Usage.TotalTokens,
		InputTokens:      localResp.Usage.PromptTokens,
		OutputTokens:     localResp.Usage.CompletionTokens,
	}, incompleteErr
}

// Embed generates embeddings by sending a request to the local /v1/embeddings endpoint.
func (p *Provider) Embed(ctx context.Context, req *llmproxy.EmbeddingRequest) (*llmproxy.EmbeddingResponse, error) {
	client, ok := p.embeddingEndpoints[req.Model]
	if !ok {
		return nil, fmt.Errorf("no embedding endpoint configured for model '%s'", req.Model)
	}

	localReq := EmbeddingRequest{
		Input: req.Inputs,
		Model: string(req.Model),
	}

	var localResp EmbeddingResponse
	if err := client.Do(ctx, "POST", "/v1/embeddings", nil, localReq, &localResp); err != nil {
		return nil, fmt.Errorf("failed to get embeddings from local endpoint: %w", err)
	}

	// Index comes from the remote server — never trust it as a slice index.
	embeddings := make([][]float32, len(localResp.Data))
	for _, d := range localResp.Data {
		if d.Index < 0 || d.Index >= len(embeddings) {
			return nil, fmt.Errorf("embedding endpoint returned out-of-range index %d for %d inputs", d.Index, len(localResp.Data))
		}
		embeddings[d.Index] = d.Embedding
	}

	return &llmproxy.EmbeddingResponse{
		Embeddings:   embeddings,
		Model:        localResp.Model,
		TokensUsed:   localResp.Usage.TotalTokens,
		InputTokens:  localResp.Usage.PromptTokens,
		OutputTokens: localResp.Usage.CompletionTokens,
	}, nil
}

// EmbeddingDimension returns the declared output dimension for the given embedding model.
func (p *Provider) EmbeddingDimension(model llmproxy.ModelID) (int, error) {
	for _, m := range p.models {
		if m.ID == model && m.EmbeddingDimension != nil {
			return *m.EmbeddingDimension, nil
		}
	}
	return 0, fmt.Errorf("unsupported embedding model: %s", model)
}

// UploadFile is not supported by local inference servers.
func (p *Provider) UploadFile(_ context.Context, _ *llmproxy.FileUploadRequest) (*llmproxy.FileUploadResponse, error) {
	return nil, fmt.Errorf("file upload %w", provider.ErrNotSupported)
}

// DeleteFile is not supported by local inference servers.
func (p *Provider) DeleteFile(_ context.Context, _ llmproxy.FileID) (bool, error) {
	return false, fmt.Errorf("file delete %w", provider.ErrNotSupported)
}
