# edge-agents

Open ForestHub workflow platform: the runtime **engine**, the **LLM proxy**, the
language-neutral **workflow contract**, and the visual **builder**. The closed
`fh-backend` (governance, hosting, multi-tenant control plane) consumes this repo;
it is not in here.

## Layout

```
contract/        SOURCE OF TRUTH. Language-neutral OpenAPI 3.0.3 schemas.
                 Owned by no language; Go, TS and Python codegen from these.
  workflow.yaml    workflow graph format (nodes/edges/channels/params).
  engine.yaml      engine deploy/control-plane wire (deploy/boot/heartbeat).
  llmproxy.yaml    LLM-proxy request/response types.
  debug.yaml       engine<->editor debug-adapter protocol ($refs workflow.yaml).
  deployment.yaml  deploy bundle/manifest wire ($refs workflow.yaml).
  ml.yaml        ML component wire (/infer + health/ready/metadata).
  camera.yaml      camera component wire (/capture + health/ready/metadata).

go/              Go module — go.mod lives HERE, not at repo root, so `go get`
                 consumers never receive the ts/ or contract/ trees.
                 Module: github.com/ForestHubAI/edge-agents/go. See go/CLAUDE.md.

ts/              npm workspace: workflow-core (headless model), workflow-builder
                 (React canvas), workflow-cli (fh-workflow CLI + reference SPA).
                 See ts/CLAUDE.md.

py/              Python service: onnx (image fh-onnx) — generic ONNX inference
                 component, FastAPI + onnxruntime, model-repository pattern.
                 Pydantic models codegen from contract/ml.yaml.
                 See py/onnx/README.md.

components/      Custom-component authoring guide + two worked examples
                 (grafana: no-build/env-only; llama: thin wrapper image).
                 Extra containers co-deployed beside the engine. See components/README.md.
```

## Two kinds of component

Both run as their own container under the same runtime contract
(`docs/component-contract.md`), but they are not interchangeable — the difference is
**who issues them**:

- **Service components** (onnx, llama, grafana, anything custom) are
  independently deployable. The operator composes them explicitly and supplies their
  URL; an environment-supplied `Resources` entry (`llmProviders` / `mlProviders`)
  points at one. Deployment is explicit composition — nothing auto-spawns.
- **Driver components** (camera) are **engine-private**. The engine is their sole
  issuer and sole caller: their config is derived from the device manifest, their
  address is a constant, and nothing in `Resources`' environment-supplied families may point at one. The
  operator never selects or configures them — they select the _hardware_, and the
  component follows.

The criterion for a driver component is: **device-owned hardware whose driver cannot
live in the engine image.** Camera qualifies because the capture stack (GStreamer,
libcamera, vendor userland) would bloat every engine image for a feature most
workflows never use. Its out-of-process-ness is a packaging fact and must stay
invisible above Layer 3 — it must never decide how the resource is _classified_.
Audio capture or a vendor SDK driver would join the same category.

Invariant that makes hardware claims safe: **one engine per device; its driver
components are singletons of that engine; hardware claims belong to that domain.**
That is what lets a driver component hold an exclusive `/dev/video0` open.

## The one rule that matters: contract is the source of truth

The keystone risk in this repo is **Go↔TS↔Python schema drift**. The defense is a
single `contract/` with codegen on every side.

- **Never hand-edit generated bindings.** Edit the contract YAML, then regenerate.
  - Go: `cd go && go generate ./...` → `go/api/*/types.gen.go`, `server.gen.go`
    (oapi-codegen; directives in `go/api/generate.go`).
  - TS: `cd ts && npm run generate` → `ts/workflow-core/src/api/workflow.ts`
    (openapi-typescript, from `contract/workflow.yaml`).
  - Python: `cd py/onnx && datamodel-codegen` → `app/api/models.py`
    (datamodel-code-generator, from `contract/ml.yaml`).
- A contract change is a three-step edit: **(1)** edit `contract/*.yaml`,
  **(2)** regenerate Go, **(3)** regenerate TS — then reconcile the hand-written
  domain/handler code each side. Updating only one side is how the two languages
  silently drift apart.
- Generated files are committed to git on purpose. A diff after regeneration means
  the contract and the checked-in bindings are out of sync.

## Domain-first: reach for the contract only at a seam

The rule above says _how_ to cross a seam; this one says _when_. Components and
libraries work in **self-contained, internal domain types** (`engine/`, `camera/`,
`llmproxy/`, `workflow-core`'s domain layer). You add a `contract/` api-type — with
codegen and a component-local mapping bridge — **only where a shape crosses a seam**:
a boundary where another implementation, same-language or cross-language, must
independently produce or consume that exact shape. No seam → no api type; keep it a
plain domain type.

- **What a seam is:** a wire between two components (engine↔component HTTP), or a
  file one side writes and another reads (the renderer writes the camera component's
  boot config, the Go component reads it — a cross-language seam, so its shape is
  contracted).
- **What is not:** a type only one implementation ever touches. A component's config
  authored by humans and read by one language (onnx's `manifest.yaml`, owned
  by its Python `Manifest`) stays a domain type — documented in that language, not
  the contract.
- **The pattern at a seam:** the generated api type is the wire shape; the domain
  keeps its own type and maps at the boundary, **inside the component that owns it**
  (`engine/mapping.go`, `camera/mapping.go`) — never a shared mapper package, which
  would make every component link every other's domain. Never let a generated type
  leak into domain logic — map it first.
- **A seam type belongs to whoever implements it, not whoever stores it.** The camera
  kinds live in `camera.yaml` and `engine.yaml` `$ref`s them, even though the device
  manifest is what holds camera _instances_: fh-camera decides what a `v4l2` or
  `rtsp` camera means, so the engine imports the camera contract and not the reverse.
  Authority over the data is not ownership of the type.

## Working across the tree

- `go/`, `ts/` and `py/` are independently buildable and releasable. A contributor
  in one tree never needs the others' toolchains — only contract edits touch all.
- Per-language conventions, build/test commands, and architecture live in
  `go/CLAUDE.md`, `ts/CLAUDE.md` and `py/CLAUDE.md`. Read the relevant one before
  editing that tree.
