// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

// Ports: the engine-owned seams for everything it needs from "outside".
// Each is an interface so the engine never depends on a concrete adapter.
// The fh-backend HTTP client (engine/backend) is one adapter that satisfies
// these; the engine is fully usable with no backend, because Retriever is
// required only when a workflow actually declares a retrieval node.
// Signatures speak the engine's own domain types (RAGQueryParams, etc.) plus
// external package types (llmproxy, api/workflow); adapters map to their own
// internal wire forms privately. See docs/engine-ports.md for the full
// required/optional matrix and standalone behavior.
//
// Status and liveness are NOT a port: a boot failure exits the process and a
// crash stops the container, both observed externally by Ranger (the ranger),
// so the engine self-reports neither — there is no Supervisor seam.
//
// Memory is NOT a port at all: it is device-storage-only, owned unconditionally
// by engine/memory.Manager. There is no remote mirror.
//
// Logging is intentionally not a port either: the engine already depends on
// the logging package, and stderr logging is unconditional, so log shipping
// is configured by main, not abstracted through engine.

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

// LlmClient is the external service for language model calls.
type LlmClient interface {
	Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error)
}

// Retriever is the external service for retrieval-augmented generation.
type Retriever interface {
	QueryRAG(ctx context.Context, params RAGQueryParams) ([]RAGQueryResult, error)
}

// MLClient is the external service for ML model inference. Both methods hit the
// same component endpoint; they differ only in how the input is encoded — named
// numeric tensors, or an opaque binary blob (e.g. an encoded image).
type MLClient interface {
	InferTensors(ctx context.Context, tensors map[string]any) (InferenceResult, error)
	InferBinary(ctx context.Context, data []byte) (InferenceResult, error)
}

// InferenceResult is one model's task-shaped output. Task names the shape Payload
// is in ("object-detection", "image-classification", "tensor"), so a consumer that
// recognises the task knows how to read the payload without knowing the model.
//
// Payload stays untyped because the only consumer today serialises it whole; decoding
// it into per-task domain structs belongs with the first node that reads a field out
// of it, not here.
type InferenceResult struct {
	Task    string
	Payload map[string]any
}

// CaptureClient is the external service for on-demand frame capture from a camera. Width and
// height are per-call: one camera serves every node bound to it and each asks for
// its own size, so a size is an argument to a capture, never a property of the
// camera. Zero means "no hint".
type CaptureClient interface {
	Capture(ctx context.Context, width, height int) ([]byte, error)
}
