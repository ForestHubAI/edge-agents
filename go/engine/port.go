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

	"github.com/ForestHubAI/fh-core/go/api/workflow"
	"github.com/ForestHubAI/fh-core/go/llmproxy"
)

// Lifecycle is the agent-registration seam (registration + periodic
// heartbeat). Local default: no-op. fh-backend adapter: POSTs to
// /agents/bootCallback and /agents/heartbeat.
type Lifecycle interface {
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

// LlmClient is the chat-completion seam. Implementation: *llmproxy.Client,
// which dispatches by model id across configured providers.
type LlmClient interface {
	Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error)
}

// Retriever is the RAG seam. Local default: empty results. fh-backend
// adapter: forwards to /rag/query.
type Retriever interface {
	QueryRAG(ctx context.Context, params RAGQueryParams) ([]RAGQueryResult, error)
}
