# Engine Ports & Implementations

The engine never depends on a concrete external service. Everything it needs
from "outside" is reached through an **interface — a port — declared in
`engine/port.go`**. Concrete adapters satisfy those interfaces and map to
their own wire forms privately, so the engine core compiles and runs without
knowing whether it's talking to the fh-backend, a local file, or nothing at
all.

There are three sources of implementation:

- **The fh-backend adapter** (`engine/backend`) — one HTTP client that
  satisfies the LLM and RAG ports, used when `FH_BACKEND_URL` is configured.
- **Built-in / standalone behavior** — what happens with no backend. For some
  ports that's a real local implementation; for others it's "the port is
  nil and the engine does without."
- **Deploy-resolved component clients** — the ML inference and camera capture
  ports are filled from the deploy's `ExternalResources` (a component URL),
  resolved in the build layer (`engine/build`), not `main.go`. They are
  backend-independent: the component is a separate container reached by URL, the
  same with or without a backend.

`cmd/engine/main.go` decides which adapter fills the backend-or-standalone
seams (LLM, RAG); the component-backed seams are wired by the build layer from
`ExternalResources`.

## The matrix

| Port                | Methods                       | Required?                                         | No backend (standalone)                          | fh-backend adapter               |
| ------------------- | ----------------------------- | ------------------------------------------------- | ------------------------------------------------ | -------------------------------- |
| `LlmClient`         | `Chat`                        | Required for agent nodes                          | Local providers via `llmproxy` (direct API keys) | Backend-routed provider fallback |
| `Retriever`         | `QueryRAG`                    | Required **only if** a retrieval node is deployed | **nil** → build rejects any Retriever node       | Forwards to `/rag/query`         |
| `MLInferenceClient` | `InferTensors`, `InferBinary` | Required **only if** an ML inference node is deployed | Deploy-resolved component client from `ExternalResources` (backend-independent) | — same (not backend-routed)  |
| `CaptureClient`     | `Capture`                     | Required **only if** a camera capture node is deployed | Deploy-resolved component client from `ExternalResources` (backend-independent) | — same (not backend-routed)  |

Three capabilities deliberately are **not** ports:

- **Status & liveness** — not self-reported. A boot failure exits the process
  and a crash stops the container; Ranger (the ranger) observes the container
  state and reports it to the backend. There is no outbound status / heartbeat
  seam — the engine had a `Supervisor` port for this, now removed.
- **Memory** — device-storage-only, owned unconditionally by
  `engine/memory.Manager`. The device always has a durable local copy; see
  [Memory](#memory--device-storage-only) below.
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

## MLInferenceClient — required only when used

`InferTensors` and `InferBinary` are the ML inference seams: both hit one
component `/infer` endpoint, differing only in how the input is encoded (named
numeric tensors, or an opaque binary blob such as an encoded image). The
adapter is `build.mlEndpoint`, a generated `mlinferenceapi` client bound to one
model name.

- **Resolution:** `build/ml.go` resolves each declared ML model against the
  deploy's `ExternalResources` (`ml-inference` arm → component URL). Many models
  may share one component — the model name is sent per request.
- **Missing:** an `MLInference` node whose model is unbound or unconfigured
  **fails the build**. Backend-independent — the component is its own container.

## CaptureClient — required only when used

`Capture` is the frame-capture seam: the engine asks a component for one encoded
frame. The adapter is `build.captureEndpoint`, a generated `cameraapi` client
bound to one camera name (and its optional width/height), so the node calls it
parameterless.

- **Resolution:** `build/capture.go` resolves each declared `CAMERA` channel
  against the deploy's `ExternalResources` (`camera` arm → component URL). Many
  cameras may share one component — the camera name is sent per request.
- **Missing:** a `CameraCapture` node whose channel is unbound or unconfigured
  **fails the build**. Backend-independent — the component is its own container.

## Memory — device-storage-only

Memory is **not a port**. `engine/memory.Manager` owns a durable directory of
`<uid>.json` records on the device filesystem and is the sole source of truth:
it reads them at boot and writes through on every mutation. There is no remote
mirror — the engine neither hydrates from nor pushes to the backend.

- **Durability:** local and durable across restarts. Mount a persistent volume
  to survive container remounts.

### Reconciliation on Restore

`Restore(ctx, declared)` is called on every build with the memory files
declared by the workflow. Content precedence is **local → declared seed**:

1. An existing **local** copy wins — this preserves the agent's accumulated
   edits across redeploys.
2. Otherwise the workflow's declared `MemoryFile.Content` is used.

So **`MemoryFile.Content` is initial content only — it never overwrites an
existing file.** Declared _metadata_ (label, description, size cap) is always
authoritative; only content is preserved.

> **Future device→cloud backup:** if a backup path is added, it will be a
> device-initiated **push** only (the device sending its memory up), never a
> backend→device restore. `Restore`/`write` already carry a `ctx` for that.

## Wiring (cmd/engine/main.go)

```
FH_BACKEND_URL set?
├─ yes → backend.Client satisfies LlmClient (fallback) and Retriever.
└─ no  → LlmClient: local providers only
          Retriever: nil (retrieval nodes fail the build)

Memory: always device-storage-only, independent of FH_BACKEND_URL.
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
