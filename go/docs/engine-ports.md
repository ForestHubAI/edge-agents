# Engine Ports & Implementations

The engine never depends on a concrete external service. Everything it needs
from "outside" is reached through an **interface — a port — declared in
`engine/port.go`**. Concrete adapters satisfy those interfaces and map to
their own wire forms privately, so the engine core compiles and runs without
knowing whether it's talking to the fh-backend, a local file, or nothing at
all.

There are two sources of implementation:

- **The fh-backend adapter** (`engine/backend`) — one HTTP client that
  satisfies every port, used when `FH_BACKEND_URL` is configured.
- **Built-in / standalone behavior** — what happens with no backend. For some
  ports that's a real local implementation; for others it's "the port is
  nil and the engine does without."

`cmd/engine/main.go` is the only place that decides which adapter fills each
seam, based on whether a backend client was constructed.

## The matrix

| Port | Methods | Required? | No backend (standalone) | fh-backend adapter |
|------|---------|-----------|-------------------------|--------------------|
| `LlmClient` | `Chat` | Required for agent nodes | Local providers via `llmproxy` (direct API keys) | Backend-routed provider fallback |
| `Retriever` | `QueryRAG` | Required **only if** a retrieval node is deployed | **nil** → build rejects any Retriever node | Forwards to `/rag/query` |
| `Supervisor` | `Register`, `Heartbeat` | Optional | **nil** → no registration/heartbeat | POSTs `/agents/bootCallback`, `/agents/heartbeat` |
| `MemorySync` | `Hydrate`, `Push` | Optional (mirror only) | **nil** → local-only memory | HTTP `GET`/`PUT /agents/memory` |

Two capabilities deliberately are **not** ports:

- **Local memory persistence** — owned unconditionally by
  `engine/memory.Manager`. The device always has a durable local copy; see
  [Memory](#memorysync-optional-remote-mirror) below.
- **Logging** — stderr is unconditional and the engine already depends on the
  `logging` package. Optional log shipping to the backend is a `logging`
  `HTTPWriter` wired by `main`, not a port.

## LlmClient — required for agent nodes

`Chat` is the chat-completion seam. The implementation is
`llmproxy.Client`, which dispatches by model id across configured providers.

- **Standalone:** providers configured with direct API keys
  (`anthropic`/`openai`/`gemini`/`mistral`/`selfhosted`). This is the primary
  path, not a fallback.
- **Backend:** any provider the backend exposes but the engine has no local
  key for is registered as a backend-routed stand-in, resolved by model id
  exactly as if it were local.
- **Missing:** an `AgentNode` with a nil `LlmClient` **fails the build**
  (`engine/build/graph.go`). There is no silent default.

## Retriever — required only when used

`QueryRAG` is the RAG seam. There is **no built-in standalone implementation
yet**.

- **Standalone:** `Retriever` is nil. A workflow that declares a Retriever
  node **fails to deploy** with a clear error, mirroring the WebSearch and
  Agent build checks. A workflow with no retrieval node deploys and runs
  fine. (This replaced a silent no-op that returned empty results.)
- **Backend:** forwards to `/rag/query`.
- **Planned:** a standalone pgvector-backed adapter (query embedding via
  `llmproxy` + similarity search + ingestion) will live in its own package
  (e.g. `engine/rag/pgvector`), not bundled with the trivial seams.

## Supervisor — optional outbound callbacks

`Supervisor` abstracts whoever receives this agent's callbacks: the
registration sent at boot plus the periodic liveness heartbeat. It is a
purely outbound seam — deploys/commands arrive the other way, through the
engine's HTTP server.

- **Standalone:** nil. With no one to report to, the engine simply doesn't
  register or heartbeat. This is correct, not degraded — pull-based health
  endpoints are the standalone observability story, not a fake heartbeat.
- **Backend:** `backend.Client` POSTs `/agents/bootCallback` and
  `/agents/heartbeat`. The retry/heartbeat loops live in
  `engine/lifecycle.go`.

## MemorySync — optional remote mirror

Memory is **local-first (edge-primary)**. `engine/memory.Manager` owns a
durable directory of `<uid>.json` records and is the source of truth: it
reads them at boot and writes through on every mutation. `MemorySync` is
*only* the optional remote mirror.

- **`Hydrate`** — pulls the agent's accumulated content. Called by the
  Manager **only on a cold start** (empty local directory) to seed a fresh
  copy.
- **`Push`** — mirrors each local write. **Best-effort**: the local write is
  the truth, so a push failure is logged and the agent keeps working.
- **Standalone:** nil. Memory is purely local and durable across restarts
  (mount a persistent volume to survive container remounts).

### Reconciliation on Restore

`Restore(ctx, declared)` is called on every build with the memory files
declared by the workflow. Content precedence is **local → cold-start mirror →
declared seed**:

1. An existing **local** copy wins — this preserves the agent's accumulated
   edits across redeploys.
2. Otherwise, on a cold start with a mirror, the **hydrated** content seeds
   the file.
3. Otherwise the workflow's declared `MemoryFile.Content` is used.

So **`MemoryFile.Content` is initial content only — it never overwrites an
existing file.** Declared *metadata* (label, description, size cap) is always
authoritative; only content is preserved.

> **Durability boundary:** with `Push` but no reverse path, the backend holds
> only what the engine has pushed; runtime edits are durable on the local
> volume. There is no backend → device or device → device reconciliation yet.
> Adding a push-back path is additive and doesn't disturb this design.

## Wiring (cmd/engine/main.go)

```
FH_BACKEND_URL set?
├─ yes → backend.Client satisfies LlmClient (fallback), Retriever,
│         Supervisor, and MemorySync.
└─ no  → LlmClient: local providers only
          Retriever:  nil (retrieval nodes fail the build)
          Supervisor: nil (no register/heartbeat)
          MemorySync: nil (local-only memory)
```

## Adding an adapter

Group by **shared dependency**, not by port:

- An adapter that talks to the fh-backend belongs in `engine/backend` (it
  shares the one HTTP client).
- A heavy standalone implementation (its own driver, ingestion, etc.) gets
  its **own package** — e.g. a pgvector `Retriever` under `engine/rag`.
  Don't bundle it with trivial seams.
- Edit `port.go` only to add or change a seam; never widen a port with a
  method a single adapter needs but the engine core doesn't call.
