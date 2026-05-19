# forge

Open ForestHub workflow platform: the runtime engine, the LLM proxy, the
language-neutral workflow contract, and the visual builder. The closed
fh-backend (governance, hosting, multi-tenant control plane) consumes this
repo; it is not in here.

## Layout

```
contract/openapi/workflow.yaml   SOURCE OF TRUTH. Language-neutral schema:
                                 workflow graph + engine deploy/debug
                                 protocol + LLM-proxy types. Owned by no
                                 language; both bindings codegen from it.

go/            (go.mod here — NOT repo root, so the module zip excludes
 ├─ contract/   ts/contract/skills)  github.com/ForestHubAI/forge/go
 │              oapi-codegen models from ../contract/openapi/workflow.yaml.
 │              fh-backend imports THIS (x-go-type-import), never regen.
 └─ engine/     workflow runtime. Imports ./../contract + its own
                capability interfaces (MemoryStore/Retriever/LogSink/
                ControlPlane). Never a concrete fh-backend client.

ts/            npm workspace
 ├─ workflow-core/    @foresthub/workflow-core — headless types (codegen
 │                    from the same workflow.yaml) + pure validator.
 └─ visual-builder/   @foresthub/visual-builder — React canvas components.
                      Imported by the open SPA AND the closed FE.

skills/        Claude Code skill wrapping the fh-workflow CLI.
```

## Why one repo, two languages

The keystone risk is Go↔TS schema drift. A monorepo with one `contract/`
and codegen enforced in CI is the strongest anti-drift structure. Each
artifact is independently versioned/releasable; a TS contributor never
needs the Go toolchain and vice versa. The Go module lives in `/go` (not
the repo root) precisely so `go get` consumers never receive the TS tree.

Cross-language type sharing: `contract/openapi/workflow.yaml` →
oapi-codegen → `go/contract` (one shared Go type, imported by the engine
and by fh-backend via `x-go-type-import`); the same file →
openapi-typescript → `ts/workflow-core`. Pin the same contract version on
both sides; CI regenerates and diffs.

## Status: SCAFFOLD

Manifests, structure, and the extracted contract are real. The engine /
llmproxy Go code and the `workflow-core` validator are **not yet moved** —
that is the sequenced in-place migration:

1. fh-backend: interface refactor (engine off the concrete backend client)
   — proven under fh-backend's existing tests, in place.
2. fh-backend + FE: repoint type usage / extract the pure validator —
   proven under existing tests, in place.
3. Only then: history-preserving move (`git filter-repo`/`subtree`) into
   `go/engine` and `ts/workflow-core`.

The new repo is the destination, not the workshop.

## LICENSE

**TODO — not chosen.** Open-core requires a deliberate license decision
(Apache-2.0 vs MIT vs a source-available license for the engine). This is
a legal/business call; pick before the first public push. `LICENSE` is a
placeholder until then.
