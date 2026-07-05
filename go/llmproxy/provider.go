// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package llmproxy

import (
	"context"
)

// Provider defines the interface for interacting with a large language model (LLM) service.
// Implementations can wrap different backends (OpenAI, Ollama, custom models, etc.).
type Provider interface {
	// ProviderID returns the unique identifier of the LLM provider.
	ProviderID() ProviderID

	// AvailableModels returns a list of supported models by the LLM service.
	AvailableModels() []ModelInfo

	// Health verifies that the LLM service is available and responding.
	// Returns an error if the service is unreachable or unhealthy.
	Health(ctx context.Context) error

	// Chat sends a text prompt (optionally with system instructions, ID of previous response,
	// files, images, and model options) to the LLM and returns the generated response.
	// The request may include structured instructions, multimodal input, and output formatting.
	Chat(ctx context.Context, req *ChatRequest) (*ChatResponse, error)

	// UploadFile uploads a file (text, PDF, image, etc.) to the LLM service.
	// Returns a FileUploadResponse containing the FileID that can be referenced in future requests.
	// Implementations may store the file temporarily or persist it depending on service capabilities.
	UploadFile(ctx context.Context, fileReq *FileUploadRequest) (*FileUploadResponse, error)

	// DeleteFile removes a previously uploaded file from the LLM service using its FileID.
	// After deletion, the file can no longer be referenced in new requests.
	DeleteFile(ctx context.Context, fileID FileID) (bool, error)
}

// Embedder is an optional capability interface for providers that support text embedding.
type Embedder interface {
	ProviderID() ProviderID
	Embed(ctx context.Context, req *EmbeddingRequest) (*EmbeddingResponse, error)
	EmbeddingDimension(model ModelID) (int, error)
}
