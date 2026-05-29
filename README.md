# edge-agents

The open ForestHub workflow platform — the runtime **engine**, the **LLM proxy**, the
language-neutral **workflow contract**, and the visual **builder**.

Everything in this repository runs **standalone and offline** — no external services or
accounts required.

> Structure and APIs are still moving. Issues and discussion
> are very welcome — and if you're planning a larger change, please open an issue first.
> See [CONTRIBUTING](.github/CONTRIBUTING.md).

## What's in here

| Path        | What                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contract/` | **Source of truth.** Language-neutral OpenAPI 3.0.3 schemas (workflow, engine, llmproxy, debug). Both Go and TS generate from these.             |
| `go/`       | Go module `github.com/ForestHubAI/edge-agents/go` — the engine runtime + LLM proxy.                                                                  |
| `ts/`       | npm workspace — `workflow-core` (headless model), `workflow-builder` (React canvas component library), `app` (reference SPA + `fh-builder` CLI). |
| `skills/`   | Claude Code skill wrapping the workflow CLI.                                                                                                     |

`go/` and `ts/` are independently buildable and releasable — a TS contributor never needs
the Go toolchain, and vice versa. Only edits to `contract/` touch both sides.

## Quickstart

### Go — engine + LLM proxy

```sh
cd go
go build ./cmd/engine    # build the engine binary
go test ./...            # run tests
```

Requires the Go version pinned in `go/go.mod`. No Makefile — run from inside `go/`.

### TypeScript — workflow model, builder, app

The three packages layer one-way: `workflow-core` ← `workflow-builder` ← `app`.
`workflow-builder` is a React component library, not a standalone program — the `app`
workspace embeds it and is what you actually run.

```sh
cd ts
npm ci
npm run build            # build all workspaces (workflow-core, workflow-builder, app)
npm test                 # run tests

# Run the reference SPA (it embeds the visual builder):
cd app && npm run dev
```

The `fh-builder` CLI also lives in the `app` workspace
(`npm run cli -- <command>`, e.g. `open`, `validate`, `bundle`). Requires Node 20+.

## The one rule that matters: the contract is the source of truth

The keystone risk in this repo is **Go↔TS schema drift**. The defense is a single
`contract/` with code generation on both sides.

- **Never hand-edit generated bindings** (`go/api/**/*.gen.go`,
  `ts/workflow-core/src/api/workflow.ts`). Edit the contract YAML, then regenerate:
  - Go: `cd go && go generate ./...`
  - TS: `cd ts && npm run generate`
- A contract change is a three-step edit: edit `contract/*.yaml`, regenerate Go,
  regenerate TS — then reconcile the hand-written domain/handler code on each side.
- Generated files are committed on purpose. A diff after regeneration means the contract
  and the checked-in bindings have drifted apart — CI enforces this.

See [`CLAUDE.md`](CLAUDE.md), [`go/CLAUDE.md`](go/CLAUDE.md) and
[`ts/CLAUDE.md`](ts/CLAUDE.md) for the full per-language conventions.

## Contributing

See [CONTRIBUTING](.github/CONTRIBUTING.md) and our
[Code of Conduct](.github/CODE_OF_CONDUCT.md). For security issues, please follow
[SECURITY.md](.github/SECURITY.md) — do **not** open public issues for vulnerabilities.

## Releasing

Release mechanics (Go module tags + npm lockstep publishing) are documented in
[RELEASING.md](RELEASING.md).

## License

edge-agents is **dual-licensed**:

- The public release is distributed under the
  [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). You may use,
  study, modify, and redistribute it under those terms — including the AGPL's
  requirement to make the complete corresponding source available to users who
  interact with a modified version over a network.
- For use cases that are incompatible with the AGPL (for example, building a
  proprietary product or service on top of edge-agents without releasing your own
  source), ForestHub offers a separate **commercial license**. Contact
  **root@foresthub.ai**.

This is a *source-available, commercial open-source* model — not a permissive
license. Third-party components retain their own licenses; see
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) and [NOTICE](NOTICE).

Contributions are accepted under a Contributor License Agreement that preserves
this dual-licensing model — see
[CONTRIBUTING § License and Contributor Agreement](.github/CONTRIBUTING.md#license-and-contributor-agreement).
