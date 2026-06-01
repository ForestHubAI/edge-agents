package engine

// Ports: the engine-owned seams for everything it needs from "outside".
// Each is an interface so the engine never depends on a concrete adapter.
// The fh-backend HTTP client is one adapter; package local provides
// offline defaults (filesystem memory, no-op lifecycle and retriever)
// so the engine is fully usable with zero account. Signatures speak the
// engine's own domain types (RAGQueryParams, etc.) plus external package
// types (llmproxy, api/workflow); adapters map to their own internal
// wire forms privately.
//
// LogSink is intentionally not a port here: the engine already depends on
// the logging package, and stderr logging is unconditional, so log shipping
// is configured by main, not abstracted through engine.

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

// Supervisor is the seam to whoever receives this agent's callbacks: the
// registration the agent sends at boot plus its periodic liveness heartbeat.
// Optional — a nil Supervisor means there is no one to report to, so the
// engine simply doesn't register or heartbeat.
type Supervisor interface {
	Register(ctx context.Context, reg AgentRegistration) error
	Heartbeat(ctx context.Context, address string) error
}

// MemoryStore is the durable-memory seam. Snapshot pulls the agent's full
// declared set; Upsert persists new content for one file. Local default:
// filesystem-backed. fh-backend adapter: HTTP sync.
type MemoryStore interface {
	Snapshot(ctx context.Context) ([]workflow.MemoryFile, error)
	Upsert(ctx context.Context, uid, content string) error
}

// LlmClient is the external service for language model calls.
type LlmClient interface {
	Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error)
}

// Retriever is the external service for retrieval-augmented generation.
type Retriever interface {
	QueryRAG(ctx context.Context, params RAGQueryParams) ([]RAGQueryResult, error)
}
