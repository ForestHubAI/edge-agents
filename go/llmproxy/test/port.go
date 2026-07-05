// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package test

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

// testProvider defines the interface for LLM providers used in tests.
// Needs to be a separate interface to avoid circular dependencies.
type testProvider interface {
	// AvailableModels returns a list of supported models by the LLM service.
	AvailableModels() []llmproxy.ModelInfo

	// Chat sends a text prompt (optionally with system instructions, ID of previous response,
	// files, images, and model options) to the LLM and returns the generated response.
	// The request may include structured instructions, multimodal input, and output formatting.
	Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error)

	// UploadFile uploads a file (text, PDF, image, etc.) to the LLM service.
	// Returns a FileUploadResponse containing the FileID that can be referenced in future requests.
	// Implementations may store the file temporarily or persist it depending on service capabilities.
	UploadFile(ctx context.Context, fileReq *llmproxy.FileUploadRequest) (*llmproxy.FileUploadResponse, error)

	// DeleteFile removes a previously uploaded file from the LLM service using its FileID.
	// After deletion, the file can no longer be referenced in new requests.
	DeleteFile(ctx context.Context, fileID llmproxy.FileID) (bool, error)
}
