# forge — migration & open-core plan

Status: **scaffold complete, no code moved**. This document is the single
source for *why* and *in what order*. Decisions here are settled — do not
relitigate without a stated reason.

---

## 1. Thesis

Open-core split of the ForestHub platform:

- **Open (this repo, `forge`)**: workflow contract, the engine runtime,
  the LLM proxy, `workflow-core` (validator), `visual-builder` (canvas
  components), the standalone SPA, the `fh-workflow` CLI + Claude skill.
- **Closed (`fh-backend`)**: governance menu, multi-tenant control plane,
  hosted memory/RAG/vector infra, auth/accounts/billing, ops, support.

The moat is the **operated + governed control plane**, not the engine
binary. Open-sourcing the engine *strengthens* this by making the workflow
format a credible standard — **only if** the open artifacts stand alone.
A crippled engine produces the worst outcome (capable users forced to
rebuild what we sell, with no reason to pay). Therefore:

> **Invariant 1.** Every open artifact must be fully usable offline with
> zero ForestHub account. The engine must remember and retrieve via local
> implementations. "Optional if backend not set" (today's
> `if backend == nil` → no memory) is amputation, not configuration.

---

## 2. Settled architecture decisions

1. **Capability interfaces, not a concrete backend client.** The engine
   owns `MemoryStore`, `Retriever`, `LogSink`, `ControlPlane`,
   (LLM-fallback) interfaces. The OSS repo ships real local impls
   (filesystem/SQLite memory, pluggable retriever, stderr JSON logs, no-op
   control plane, direct-provider LLM). `fh-backend` becomes *one*
   implementation, living in the closed repo. The engine never imports a
   concrete `fh-backend` HTTP client.

2. **Schema ownership inverted.** `contract/openapi/workflow.yaml` is the
   language-neutral SOURCE OF TRUTH. `fh-backend` consumes it; it does not
   own it. Neither Go nor TS owns it — both codegen from it.

3. **Type sharing via `x-go-type-import`, not import-mapping.** The Go
   `contract` package is generated once (`go/contract`). `fh-backend`
   annotates its workflow-bearing fields with `x-go-type` +
   `x-go-type-import` pointing at `github.com/ForestHubAI/forge/go/contract`,
   so its generated code uses the *shared* type — no regenerated copy, no
   spec syncing, no conversion at the `backend → engine` boundary.
   *Validate this against the actual oapi-codegen version in Phase 2 — it
   is the load-bearing assumption.*

4. **Polyglot monorepo; Go module rooted at `/go`.** Not the repo root —
   so the module zip served to `go get` excludes `/ts`, `/contract`,
   `/skills`. Tags are subdirectory-prefixed (`go/vX.Y.Z`,
   `contract/vX.Y.Z`). One Go module spanning `./contract` + `./engine`
   (no intra-repo module-version dance); split later only if their
   stability genuinely diverges.

5. **Three neutral cross-language contracts**: (a) the workflow schema,
   (b) the engine debug protocol, (c) the deploy/control-plane wire types.
   All live in `contract/`. None owned by a single binding.

6. **FE roles**: `workflow-core` (headless TS — types + serialization +
   pure validator, no React), `visual-builder` (React component lib,
   imports workflow-core), the open SPA (thinnest shell over
   visual-builder), the `fh-workflow` CLI (wraps workflow-core), a thin
   Claude skill (wraps the CLI). The closed FE imports `visual-builder` +
   `workflow-core` directly — **not** via the SPA.

7. **Engine ↔ editor seam = the debug protocol only.** The engine never
   serves the SPA or validates workflows (its `Build` does *executability
   gating*, which is not authoring validation — keep it). The CLI is the
   AI-validation primitive; **do not build an LSP** for the agent use case
   (an agent has a file + wants pass/fail + JSON, not stdio JSON-RPC).

---

## 3. Repo structure (built)

```
contract/openapi/workflow.yaml   SOURCE OF TRUTH (99 schemas, 0 dangling $ref)
go/        (go.mod — module github.com/ForestHubAI/forge/go)
 ├─ contract/   oapi-codegen models from ../contract/openapi/workflow.yaml
 └─ engine/     runtime (scaffold)
ts/        npm workspace
 ├─ workflow-core/    @foresthub/workflow-core
 └─ visual-builder/   @foresthub/visual-builder
skills/workflow-validate/   Claude skill (scaffold)
```

---

## 4. Migration sequence

The new repo is the **destination, not the workshop**. Every seam is
proven *in place under existing test suites* before code moves. The engine
is live (agents deployed) — **no rewrite-from-scratch**.

### Phase 0 — Contract extraction ✅ DONE
- Sliced workflow/engine/channel/debug + LLM-proxy + deps out of
  `fh-backend/openapi/openapi.yaml` → `contract/openapi/workflow.yaml`.
- Excluded: auth, accounts, projects, billing, CRUD, test-agent.
- Open TODO: slim `Network` (carries `accountId`/`deviceCount`/
  `agentCount`); re-audit agent boot/heartbeat/memory protocol types.

### Phase 1 — fh-backend in-place: separate the engine from fh-backend typing
**(detailed in §5 — this is the bulk of the prep work).** Done entirely in
`fh-backend`, validated under its existing Go tests. Nothing moves yet.

### Phase 2 — Dual codegen wiring (in place)
- `go/contract`: `go get -tool oapi-codegen`; `go generate ./...`; commit
  `contract.gen.go`.
- `ts/workflow-core`: `npm run codegen`; commit `src/generated/contract.ts`.
- `fh-backend`: repoint its oapi-codegen via `x-go-type-import` at
  `forge/go/contract`. **Prove `go build ./...` + full test suite green.**
  If `x-go-type-import` fights the toolchain, fall back to bundle-for-docs
  + the contract module for types. Decide here, before any move.
- CI on both repos: regenerate + `git diff --exit-code` (anti-drift).

### Phase 3 — History-preserving move of Go code
- `git filter-repo` / `subtree split` `internal/engine`, `internal/llmproxy`,
  and the engine-needed `internal/util/*` from `fh-backend` into
  `go/engine` (+ packages). Rewrite import paths
  `fh-backend/internal/...` → `github.com/ForestHubAI/forge/go/...`.
- `fh-backend` switches to depend on the tagged `forge/go` module +
  imports `forge/go/engine` for local-debug; deletes the moved trees.
- Preserve conventions in moved code: singular package names; no param
  structs; comment brevity; mapping returns values not pointers; engine
  skips mapping for pure-transport types.

### Phase 4 — FE validator extraction (in place, then move)
- In the FE monolith, under existing FE tests: parameterize
  `validateAllCanvases()` → `validateWorkflow(serialized)`; pull it + the
  expression checker out of React (headless, Node-runnable).
- Then move into `ts/workflow-core`; wire `npm run codegen` types.

### Phase 5 — CLI + Claude skill
- `fh-workflow validate <file>` → JSON diagnostics + exit code.
- `npx`-friendly; the skill is ~20 lines of glue over it.

### Phase 6 — SPA + visual-builder
- Extract canvas/editor into `ts/visual-builder` (component lib, no shell).
- Thin open SPA wraps it; `fh-workflow open` launches it (Node dev tool —
  **not** the Go engine).
- Closed FE switches to import `visual-builder` + `workflow-core`.

### Phase 7 — Debug protocol (net-new)
- Today `cmd/engine/main.go` exposes only `GET /healthz`, `POST /deploy`,
  `POST /stop`. Add `/debug` + SSE (debug-mode only).
- Define the protocol in `contract/` (the neutral engine↔editor wire).
- Editor connects as a transport-agnostic debug adapter.

### Later / optional
- Real stdio LSP — only if a human editor-ecosystem need materializes.

---

## 5. fh-backend in-place refactor (Phase 1, detailed)

Goal: the engine compiles and tests **without any `fh-backend`-specific
type or the concrete backend HTTP client**, while still living in
`fh-backend`. This is what makes "backend imports engine for local debug"
even compilable (no import cycle) and de-risks the whole split.

### 5.1 Coupling inventory (cut these)

| Engine site | Couples to | Action |
|---|---|---|
| `internal/engine/backend/client.go` (`Client`, `NewClient`) | `internal/util/httpclient`, agent-secret HTTP to fh-backend | Becomes a *closed-repo* impl of the new interfaces. Delete from engine. |
| `internal/engine/backend/{bootcallback,heartbeat}.go` | `/agents/bootCallback`, `/agents/heartbeat` | → `ControlPlane` interface. Local default: no-op. |
| `internal/engine/backend/memory.go` + `memory/manager.go` (`if m.backend == nil`) | `/agents/memory`, `api.MemoryFile` | → `MemoryStore` interface. Local default: filesystem/SQLite (kills the nil-check amputation). |
| `internal/engine/backend/rag.go` + `node/retriever.go` | `/rag/query`, `domain.RAGQueryParams` | → `Retriever` interface. Local default: pluggable (sample pgvector/qdrant). |
| `internal/engine/backend/llm.go` (`GetProviders`,`Chat`) + `node/websearchtool.go` | `/llm/*`, `internal/mapping`, `internal/llmproxy` | → optional LLM-fallback interface. Default: llmproxy direct providers only (llmproxy already standalone). |
| `internal/engine/logging/httpwriter.go` | pushes logs to backend | → `LogSink` interface. Local default: stderr JSON. |
| `internal/engine/engine.go` `BuildFunc` | `*api.Workflow`, `*engineproxy.NetworkManifest` | Repoint to `contract` types. |
| `internal/engine/build/build.go` `Builder`/`buildContext` | `*backend.Client`, `*llmproxy.Client`, `*memory.Manager` | Replace concrete fields with the interfaces above. |
| engine wire I/O | `engineproxy.{DeployRequest,NetworkManifest,StatusResponse}` | These are the deploy/control-plane *wire* contract → move to `contract`; `engineproxy` *client* stays closed in fh-backend. |
| engine type usage | `internal/api`, `internal/domain`, `internal/mapping` | Repoint to `contract`; for pure-transport types the engine skips mapping (existing rule). |

### 5.2 Steps (each ends green under `go test ./...` in fh-backend)

1. **Define interfaces in the engine package** (engine-owned):
   `ControlPlane` (Boot, Heartbeat), `MemoryStore` (Snapshot, Upsert),
   `Retriever` (Query), `LogSink` (Write), optional `LLMGateway` (Providers,
   Chat). One sentence of doc each; methods say what they do.
2. **Adapt `backend.Client` to satisfy them** (temporary: still in
   fh-backend, now behind the interfaces) — pure refactor, tests unchanged.
3. **Inject interfaces, delete concrete fields** in `Builder` /
   `buildContext` / `memory.Manager` / nodes. Remove every
   `if backend == nil`; replace with the injected interface (no-op /
   local impl is always non-nil).
4. **Ship local default impls** in the engine package (filesystem memory,
   stderr LogSink, no-op ControlPlane, direct-LLM). Add engine-level tests
   that exercise the engine with *only* local impls (the "standalone"
   guarantee, Invariant 1).
5. **Repoint engine types** off `internal/api`/`domain`/`engineproxy` onto
   `contract` (pre-Phase-2: a local package mirroring
   `contract/openapi/workflow.yaml`; Phase-2 swaps it for the real tagged
   module). Keep `internal/mapping` only where the *backend* needs it;
   engine uses contract types directly for pure transport.
6. **`fh-backend` wires its own impls**: the old `backend.Client` becomes
   the closed `ControlPlane`/`MemoryStore`/`Retriever`/`LogSink`/LLM impl,
   constructed in `cmd/main.go` and passed into the engine.
7. Full `go build ./...` + `go test ./...` green. Only now Phase 2/3.

> After interface changes touch `service/port.go`-style boundaries,
> regeneration of mocks is the user's job (`go tool mockery`) — never edit
> `mocks_test.go`.

---

## 6. Open decisions / risks

- **LICENSE**: not chosen. Open-core legal/business call (permissive vs
  source-available). Blocks first public push. `LICENSE` is a placeholder.
- **`x-go-type-import`** must be validated against the real oapi-codegen
  version in Phase 2 — the riskiest assumption; bundle fallback documented.
- **`Network` schema leak** — slim before publish (TODO inline in
  `workflow.yaml`).
- **Go version**: use `go 1.24` (the abandoned `../open` had a bogus
  `1.26.1`). `../open` is dead — ignore it.
- **Live engine**: agents are deployed against the current engine. Phase 1
  must not change runtime behavior; it is a pure decoupling refactor under
  existing tests.
- Pre-existing `TestToolUse` in llmproxy/agent may fail (known, unrelated).

---

## 7. Guardrails (do not violate)

1. Open artifacts work offline, zero account (Invariant 1).
2. Engine never imports a concrete fh-backend client; only interfaces.
3. `contract/openapi/workflow.yaml` is the only source of truth; both
   bindings codegen from it; generated code committed; CI diffs it.
4. Go module stays rooted at `/go`; subdir-prefixed version tags.
5. Prove every seam in place under existing tests *before* moving code;
   moves are history-preserving and mechanical, never rewrites.
6. Engine = runtime only. It does not validate or serve UI. The only
   engine↔editor wire is the debug protocol.
