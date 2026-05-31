# edge-agents

**A ~32 MB AI agent runtime for edge devices.** Runs offline. GPIO, MQTT, and UART as first-class nodes. From a Raspberry Pi to industrial gateways.

[![CI](https://github.com/ForestHubAI/edge-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/ForestHubAI/edge-agents/actions/workflows/ci.yml)
[![Go Reference](https://pkg.go.dev/badge/github.com/ForestHubAI/edge-agents/go.svg)](https://pkg.go.dev/github.com/ForestHubAI/edge-agents/go)
[![Go Version](https://img.shields.io/github/go-mod/go-version/ForestHubAI/edge-agents?filename=go%2Fgo.mod)](go/go.mod)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/ForestHubAI/edge-agents?style=flat)](https://github.com/ForestHubAI/edge-agents/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/ForestHubAI/edge-agents)](https://github.com/ForestHubAI/edge-agents/commits)
[![GitHub issues](https://img.shields.io/github/issues/ForestHubAI/edge-agents)](https://github.com/ForestHubAI/edge-agents/issues)

`edge-agents` is the open-source core of the [ForestHub](https://foresthub.ai)
platform. It contains the Go runtime engine, a multi-provider LLM proxy with
first-class support for on-device small language models, the OpenAPI contracts
that define every wire format, and the React-based visual workflow builder.
The hosted multi-tenant control plane is a separate commercial product and is
not in this repository.

> Status: `go/v1.0.1`. Runtime is in production use; contract and TypeScript
> APIs may still move. Open an issue before larger changes.

## Features

- **Workflow engine** — graph runtime as a state machine; nodes for LLM
  calls, hardware I/O, MQTT, web search, memory, control flow, and
  expressions.
- **Cloud LLM proxy** — Anthropic, OpenAI, Google Gemini, Mistral. Provider
  dispatched implicitly from the model id.
- **Local SLM provider** — typed multi-endpoint registry for on-device small
  language models served by `llama.cpp`, `vLLM`, `Ollama`, or any
  OpenAI-compatible endpoint, with capability-based routing
  (`chat` / `embedding` / `classification` / …).
- **Visual builder** — React Flow canvas with typed nodes, ports, and live
  validation, embeddable as a component or runnable via the bundled SPA.
- **Hardware nodes** — GPIO, ADC, DAC, PWM, UART/serial via native Linux
  drivers; digital and analog signal types are first-class in the contract.
- **Standalone mode** — engine boots and runs workflows with no backend,
  no account, and no outbound calls beyond LLM provider APIs.
- **Contract-typed wire format** — every API generated from `contract/*.yaml`
  in both Go and TypeScript; CI fails on drift.
- **Distroless multi-arch container** — `linux/amd64` and `linux/arm64`,
  nonroot, ~32 MB.

## Contents

| Path | What it contains |
| --- | --- |
| [`contract/`](contract) | OpenAPI 3.0.3 schemas — single source of truth for Go and TS. |
| [`go/`](go) | Engine binary, LLM proxy, hardware drivers, MQTT transport. Module `github.com/ForestHubAI/edge-agents/go`, Go 1.25. |
| [`ts/workflow-core`](ts/workflow-core) | `@foresthubai/workflow-core` — headless workflow model, validation, (de)serialization. No React. |
| [`ts/workflow-builder`](ts/workflow-builder) | `@foresthubai/workflow-builder` — React canvas component. |
| [`ts/app`](ts/app) | Reference SPA + `fh-builder` CLI. Not published. |
| [`skills/`](skills) | Claude Code skill wrapping the workflow CLI. |

Go and TypeScript are independently buildable. Only `contract/` edits touch
both sides.

## Why edge-agents

Most AI agent frameworks assume datacenter GPUs and always-on cloud APIs.
`edge-agents` is built for the other end of the spectrum — embedded Linux on
industrial gateways, SBCs, and edge nodes. Here is how it compares to projects
people often evaluate alongside it.

| | edge-agents | LangGraph | n8n | Dify |
|---|---|---|---|---|
| Container image (compressed) | **~32 MB** | n/a (Python library) | ~368 MB | ~900 MB |
| Runs offline / air-gapped | first-class (`ENGINE_STANDALONE=true`) | depends on host app | possible, manual telemetry-disable | not designed for it |
| Hardware I/O (GPIO, ADC/DAC/PWM, UART) | first-class engine nodes | no | only via shell-exec workarounds | no |
| MQTT transport | first-class | no | community node | no |
| Visual builder | yes (React Flow, embeddable) | no | yes | yes |
| Local SLMs (`llama.cpp`, `vLLM`, `Ollama`, …) | typed registry, capability routing | via custom code | community nodes | yes |
| License | AGPL-3.0 + commercial | MIT | Sustainable Use License | Apache-2.0 |

Container sizes were measured against the latest public images on Docker Hub
in May 2026 (n8n: `n8nio/n8n:latest`, Dify: `langgenius/dify-api:main`); the
`edge-agents` figure is the linux/arm64 binary cross-compiled with
`CGO_ENABLED=0 -ldflags='-s -w'` on top of `gcr.io/distroless/static-debian12`.

## Quickstart

### Engine (Docker)

```sh
docker run --rm -p 8081:8081 \
  -e ENGINE_STANDALONE=true \
  ghcr.io/foresthubai/edge-agents/engine:latest
```

Standalone mode starts the engine with no control plane, no account, and no
outbound calls beyond LLM provider APIs. HTTP API on `:8081`.

### Engine (from source)

```sh
cd go
go build ./cmd/engine
./engine
```

Requires the Go version pinned in `go/go.mod`. Configuration via `ENGINE_*`
environment variables — see `go/cmd/engine/config.go`.

### Visual builder

```sh
cd ts
npm ci
cd app && npm run dev      # http://localhost:5173
```

### Validate a workflow

```sh
cd ts/app
npm run validate -- path/to/file.workflow.json
# exit 0 → clean; exit 1 → diagnostics JSON on stdout
```

## Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                       contract/  (OpenAPI 3.0.3)                       │
│                       SOURCE OF TRUTH — Go and TS                      │
│                       both regenerate from here.                       │
└────────────────────────┬───────────────────────────────┬───────────────┘
                         │                               │
                  go generate                      npm run generate
                         │                               │
                         ▼                               ▼
┌────────────────────────────────┐  ┌────────────────────────────────────┐
│            go/                 │  │              ts/                   │
│                                │  │                                    │
│  cmd/engine    binary          │  │  workflow-core    headless model   │
│  engine/       state machine   │  │  workflow-builder React canvas     │
│  llmproxy/     cloud + local   │  │  app              reference SPA +  │
│  driver/       GPIO/UART/...   │  │                   fh-builder CLI   │
│  transport/    MQTT            │  │                                    │
│                                │  │                                    │
│  → engine binary (distroless)  │  │  → @foresthubai/workflow-core      │
│  → multi-arch container        │  │  → @foresthubai/workflow-builder   │
└────────────────────────────────┘  └────────────────────────────────────┘
```

A workflow is a directed graph of typed nodes — LLM call, hardware I/O, MQTT,
web search, memory, control flow, expressions — connected by edges with one
of five types: `control`, `tool`, `agentTask`, `agentChoice`, `agentDelegate`.

The engine interprets the graph as a state machine: wait for event → execute
node → transition. Triggers run as parallel goroutines. The HTTP layer is
generated by `oapi-codegen` from `contract/engine.yaml` as a strict server;
the workflow types are generated from `contract/workflow.yaml` and reused
without modification by the TypeScript model.

Engine ports `Lifecycle`, `Retriever`, and `MemoryStore` have offline default
adapters in `go/engine/local/` (no-op registration, no-op RAG, filesystem-backed
memory). With the Local LLM provider configured, the engine runs entirely
without network access.

## The contract is the source of truth

Schema drift between Go and TypeScript is the highest technical risk in this
repository. The defense is one authoritative contract with codegen on both
sides, committed bindings, and a CI job that fails on drift.

- Edit `contract/*.yaml`.
- `cd go && go generate ./...` regenerates `go/api/**/*.gen.go`.
- `cd ts && npm run generate` regenerates `ts/workflow-core/src/api/workflow.ts`.
- Generated files are committed; CI diffs them against a fresh regeneration.

See [`CLAUDE.md`](CLAUDE.md), [`go/CLAUDE.md`](go/CLAUDE.md), and
[`ts/CLAUDE.md`](ts/CLAUDE.md) for per-language conventions.

## LLM providers and on-device SLMs

Four cloud providers and one Local provider for on-device inference. Provider
is dispatched implicitly from the model id; switching from a cloud LLM to a
local SLM is a one-line model-id change.

| Provider | Configuration |
| --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| Google Gemini | `GEMINI_API_KEY`, or a Vertex AI service account |
| Mistral | `MISTRAL_API_KEY` |
| Local | Typed YAML registry (see below) |

### Local provider

The Local provider models the common edge-SLM topology directly: one process
per model — the standard for `llama.cpp` / `llama-server` and `vLLM` — each
declaring its capabilities and, for embedders, its output dimension. The
proxy routes requests to the right model by capability, so a workflow can use
a chat SLM, an embedder, and a classifier in one pass without knowing where
each one is hosted.

```yaml
# local-models.yaml
endpoints:
  - url: http://localhost:8080
    models:
      - id: llama-3.1-8b-instruct
        capabilities: [chat, reasoning, function_call]
  - url: http://localhost:8081
    models:
      - id: nomic-embed-text-v1.5
        capabilities: [embedding]
        dimension: 768
  - url: http://localhost:8082
    models:
      - id: distil-classifier
        capabilities: [classification]
```

Declarable capabilities: `chat`, `embedding`, `classification`, `reasoning`,
`vision`, `function_call`, `code`, `fine_tuning`. Any OpenAI-compatible HTTP
endpoint works — `llama.cpp`, `vLLM`, `Ollama`, `LM Studio`, custom.

## Hardware and transports

Engine ships with nodes for:

- **GPIO** via `go-gpiocdev` (digital in/out, edge triggers).
- **ADC / DAC / PWM** via Linux character-device interfaces.
- **UART / serial** via `go.bug.st/serial`.
- **MQTT** via Eclipse Paho — topic-scoped channels for device-to-device
  messaging.
- **Web search** as a pluggable node.

Digital and analog signal types are first-class in the workflow contract.

## Targets

| Target | Status |
| --- | --- |
| Linux `amd64` / `arm64` server, gateway, SBC | Supported. Multi-arch distroless container. |
| Raspberry Pi 4/5, NVIDIA Jetson Orin | Supported. |
| macOS `arm64` / `amd64` | Supported (development). |
| Bare-metal MCU (Cortex-M) | Not supported by the Go engine. Contract is portable; a dedicated MCU runtime is on the roadmap. |

## Releases

- **Go runtime** — tagged `go/vX.Y.Z`. Consumers pin with
  `go get github.com/ForestHubAI/edge-agents/go@vX.Y.Z`. Current: `go/v1.0.1`.
- **TypeScript packages** — `@foresthubai/workflow-core` and
  `@foresthubai/workflow-builder` ship in lockstep at the same version.
- **Container image** — multi-arch (`linux/amd64`, `linux/arm64`),
  distroless, nonroot, published to GitHub Container Registry.

Full release mechanics are in [RELEASING.md](RELEASING.md).

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — repo-wide architecture and the contract rule.
- [`go/CLAUDE.md`](go/CLAUDE.md) — Go conventions and engine architecture.
- [`ts/CLAUDE.md`](ts/CLAUDE.md) — TypeScript workspace conventions.
- [`ts/workflow-core/docs/`](ts/workflow-core/docs) — workflow model,
  parameters, persistence, functions.
- [`ts/workflow-builder/docs/`](ts/workflow-builder/docs) — builder
  architecture, change tracking, selection.

## Contributing

See [CONTRIBUTING](.github/CONTRIBUTING.md) and the
[Code of Conduct](.github/CODE_OF_CONDUCT.md). Open an issue before any
non-trivial change. Every contribution is accepted under a Contributor
License Agreement that preserves the dual-licensing model.

## Security

Do not open public issues for security vulnerabilities. Use
[GitHub private vulnerability reporting](https://github.com/ForestHubAI/edge-agents/security/advisories/new)
or email **root@foresthub.ai**. See [SECURITY.md](.github/SECURITY.md) for
scope and process.

## License

Dual-licensed:

- [AGPL-3.0-only](LICENSE) for open-source use — including the AGPL
  requirement to make corresponding source available to users who interact
  with a modified version over a network.
- A separate **commercial license** for use cases incompatible with the AGPL.
  Contact **root@foresthub.ai**.

Third-party components retain their own licenses; see
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) and [NOTICE](NOTICE).

---

Built by [ForestHub](https://foresthub.ai) — the platform for embedded and edge AI agents.
