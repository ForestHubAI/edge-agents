package engine

// Ports: the engine-owned seams for everything it needs from "outside".
// Each is an interface so the engine never depends on a concrete adapter.
// The fh-backend HTTP client (engine/backend) is one adapter that satisfies
// all three; the engine is fully usable with no backend, because MemorySync is
// optional (nil) and Retriever is required only when a workflow actually
// declares a retrieval node. Signatures speak the engine's own domain types
// (RAGQueryParams, etc.) plus external package types (llmproxy, api/workflow);
// adapters map to their own internal wire forms privately. See docs/engine-ports.md
// for the full required/optional matrix and standalone behavior.
//
// Status and liveness are NOT a port: a boot failure exits the process and a
// crash stops the container, both observed externally by Ranger (the nucleus),
// so the engine self-reports neither — there is no Supervisor seam.
//
// Memory is deliberately NOT a "where it's stored" port: local filesystem
// persistence is owned unconditionally by engine/memory.Manager. MemorySync
// is only the optional remote mirror.
//
// Logging is intentionally not a port either: the engine already depends on
// the logging package, and stderr logging is unconditional, so log shipping
// is configured by main, not abstracted through engine.

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

// MemorySync is the OPTIONAL remote mirror for agent memory. The Manager
// owns local filesystem persistence unconditionally; when a MemorySync is
// configured it hydrates from the mirror on a cold start (empty local copy)
// and pushes every local write back. nil → local-only: no hydration, no
// mirroring. fh-backend adapter: HTTP. Push is best-effort — a mirror
// failure must not fail the agent's local write.
type MemorySync interface {
	Hydrate(ctx context.Context) ([]workflow.MemoryFile, error)
	Push(ctx context.Context, uid, content string) error
}

// LlmClient is the external service for language model calls.
type LlmClient interface {
	Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error)
}

// Retriever is the external service for retrieval-augmented generation.
type Retriever interface {
	QueryRAG(ctx context.Context, params RAGQueryParams) ([]RAGQueryResult, error)
}
