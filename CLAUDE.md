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
  mlinference.yaml ML inference component wire (/infer + health/ready/metadata).
  camera.yaml      camera component wire (/capture + health/ready/metadata).

go/              Go module — go.mod lives HERE, not at repo root, so `go get`
                 consumers never receive the ts/ or contract/ trees.
                 Module: github.com/ForestHubAI/edge-agents/go. See go/CLAUDE.md.

ts/              npm workspace: workflow-core (headless model), workflow-builder
                 (React canvas), workflow-cli (fh-workflow CLI + reference SPA).
                 See ts/CLAUDE.md.

py/              Python service: ml-inference (fh-onnx) — generic ONNX inference
                 component, FastAPI + onnxruntime, model-repository pattern.
                 Pydantic models codegen from contract/mlinference.yaml.
                 See py/ml-inference/README.md.

components/      Custom-component authoring guide + two worked examples
                 (grafana: no-build/env-only; llama-server: thin wrapper image).
                 Extra containers co-deployed beside the engine. See components/README.md.
```

## The one rule that matters: contract is the source of truth

The keystone risk in this repo is **Go↔TS↔Python schema drift**. The defense is a
single `contract/` with codegen on every side.

- **Never hand-edit generated bindings.** Edit the contract YAML, then regenerate.
  - Go: `cd go && go generate ./...` → `go/api/*/types.gen.go`, `server.gen.go`
    (oapi-codegen; directives in `go/api/generate.go`).
  - TS: `cd ts && npm run generate` → `ts/workflow-core/src/api/workflow.ts`
    (openapi-typescript, from `contract/workflow.yaml`).
  - Python: `cd py/ml-inference && datamodel-codegen` → `app/api/models.py`
    (datamodel-code-generator, from `contract/mlinference.yaml`).
- A contract change is a three-step edit: **(1)** edit `contract/*.yaml`,
  **(2)** regenerate Go, **(3)** regenerate TS — then reconcile the hand-written
  domain/handler code each side. Updating only one side is how the two languages
  silently drift apart.
- Generated files are committed to git on purpose. A diff after regeneration means
  the contract and the checked-in bindings are out of sync.

## Domain-first: reach for the contract only at a seam

The rule above says *how* to cross a seam; this one says *when*. Components and
libraries work in **self-contained, internal domain types** (`engine/`, `llmproxy/`,
`workflow-core`'s domain layer). You add a `contract/` api-type — with codegen and,
in Go, a `mapping/` bridge — **only where a shape crosses a seam**: a boundary where
another implementation, same-language or cross-language, must independently produce
or consume that exact shape. No seam → no api type; keep it a plain domain type.

- **What a seam is:** a wire between two components (engine↔component HTTP), or a
  file one side writes and another reads (the renderer writes `cameras.json`, the
  Go camera component reads it — a cross-language seam, so its shape is contracted).
- **What is not:** a type only one implementation ever touches. A component's config
  authored by humans and read by one language (ml-inference's `manifest.yaml`, owned
  by its Python `Manifest`) stays a domain type — documented in that language, not
  the contract.
- **The pattern at a seam:** the generated api type is the wire shape; the domain
  keeps its own type and maps at the boundary (Go: `mapping/`, or a domain-local
  builder like `camera.BuildSources`). Never let a generated type leak into domain
  logic — map it first.

## Working across the tree

- `go/`, `ts/` and `py/` are independently buildable and releasable. A contributor
  in one tree never needs the others' toolchains — only contract edits touch all.
- Per-language conventions, build/test commands, and architecture live in
  `go/CLAUDE.md`, `ts/CLAUDE.md` and `py/CLAUDE.md`. Read the relevant one before
  editing that tree.
