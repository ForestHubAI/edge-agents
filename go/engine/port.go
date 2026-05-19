package engine

// Ports: the engine-owned seams for everything it needs from "outside".
// Each is an interface so the engine never depends on a concrete fh-backend
// client (PLAN guardrail 2). The fh-backend HTTP client is ONE adapter;
// package local provides offline defaults so the engine is fully usable
// with zero account (PLAN Invariant 1). Signatures speak engine DOMAIN
// types, never generated wire structs — an adapter that crosses HTTP maps
// domain<->wire privately; a local adapter needs no mapping.
//
// LogSink is intentionally not a port here: the engine already depends on
// the logging package, and stderr logging is unconditional, so log shipping
// is configured by main, not abstracted through engine.

import (
	"context"

	"github.com/ForestHubAI/fh-core/go/api/workflow"
)

// ControlPlane is the agent-registration seam (boot callback + heartbeat).
// Local default: no-op. fh-backend adapter: POSTs to the control plane.
type ControlPlane interface {
	BootCallback(ctx context.Context, publicAddress, status string, loadedManifest *DeviceManifest, errorMsg *string) error
	BootCallbackWithRetry(ctx context.Context, publicAddress, status string, loadedManifest *DeviceManifest, errorMsg *string)
	Heartbeat(ctx context.Context, publicAddress string) error
	HeartbeatLoop(ctx context.Context, publicAddress string)
}

// MemoryStore is the durable-memory seam. Snapshot pulls the agent's full
// declared set; Upsert persists new content for one file. Local default:
// filesystem-backed. fh-backend adapter: HTTP sync.
type MemoryStore interface {
	Snapshot(ctx context.Context) ([]workflow.MemoryFile, error)
	Upsert(ctx context.Context, uid, content string) error
}

// Retriever is the RAG seam. Local default: empty results. fh-backend
// adapter: forwards to /rag/query.
type Retriever interface {
	QueryRAG(ctx context.Context, params RAGQueryParams) ([]RAGQueryResult, error)
}
