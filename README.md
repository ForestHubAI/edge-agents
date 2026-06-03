# edge-agents

**The 15 MB open-source AI agent runtime for edge devices.**

![edge-agents demo](docs/assets/hero.gif)

[![CI](https://github.com/ForestHubAI/edge-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/ForestHubAI/edge-agents/actions/workflows/ci.yml)
[![Go Reference](https://pkg.go.dev/badge/github.com/ForestHubAI/edge-agents/go.svg)](https://pkg.go.dev/github.com/ForestHubAI/edge-agents/go)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

Offline by default. GPIO, MQTT, OPC-UA as first-class nodes. Local SLMs alongside cloud LLMs in the same workflow.

> Today's AI agents live in datacenters. The interesting workloads — sensors, machines, vehicles, gateways — live everywhere else. **edge-agents** brings the agent paradigm to the devices that interact with the real world: small enough to run on a Pi 5, capable enough to drive an industrial controller, with hardware I/O as native primitives instead of REST shims.

## What you can build

- **Voice assistant on a Pi with a local SLM** — wake-word → STT → agent → TTS, no internet required
- **Predictive maintenance on industrial gear** — live OPC-UA vibration stream → LLM decides → MQTT alert
- **Local RAG on a Jetson** — agent answers grounded in live sensor and machine state, not the public web

## edge-agents vs other agent frameworks

|                                             | edge-agents             | n8n             | LangGraph        | Dify           | OpenClaw           |
| ------------------------------------------- | ----------------------- | --------------- | ---------------- | -------------- | ------------------ |
| **Runtime size**                            | 15 MB container         | ~500 MB Docker  | Python library   | ~500 MB Docker | ~1 GB Docker       |
| **Offline by default**                      | ✅                      | ❌              | depends on host  | ❌             | ❌ datacenter-only |
| **Hardware I/O (GPIO, UART, ADC) as nodes** | ✅ first-class          | ❌              | ❌               | ❌             | ❌                 |
| **On-device SLM provider**                  | ✅ typed multi-endpoint | ❌              | partial via libs | ❌             | ❌                 |
| **MQTT as workflow transport**              | ✅ first-class          | community node  | ❌               | ❌             | ❌                 |
| **Visual builder**                          | ✅                      | ✅              | ❌ code-only     | ✅             | ❌                 |
| **Industrial protocols** (OPC-UA, Modbus)   | on roadmap              | community nodes | ❌               | ❌             | ❌                 |

## Quickstart

```sh
docker run --rm -p 8081:8081 \
  -e ENGINE_STANDALONE=true \
  ghcr.io/foresthubai/edge-agents/engine:latest
```

Engine HTTP API on `:8081`. No control plane, no account, no outbound calls beyond LLM provider APIs.

<details>
<summary>From source / visual builder</summary>

**From source:**

```sh
cd go
go build ./cmd/engine
./engine
```

Requires the Go version pinned in `go/go.mod`. Configuration via `ENGINE_*` env vars — see `go/cmd/engine/config.go`.

**Visual builder:**

```sh
cd ts
npm ci
cd workflow-cli && npm run dev      # http://localhost:5173
```

</details>

## Getting started — authoring workflows

A workflow is a `*.workflow.json` you author, validate, and open in the visual
builder. Two ways to run the `fh-workflow` CLI — both drive the same tool:

**From this repo (works today):**

```sh
git clone https://github.com/ForestHubAI/edge-agents
cd edge-agents
npm install                                # also installs the ts/ toolchain via postinstall

npm run check-schema -- my.workflow.json   # structural: types, required fields, enums
npm run validate    -- my.workflow.json    # semantic: wiring, references, types
npm run open        -- my.workflow.json    # open in the builder; Save writes back to the file
```

The `--` is required so npm passes the path to the CLI, not to npm itself. (These
root scripts delegate to `ts/workflow-cli`; you can run them from there too.)

**Keeping dependencies fresh.** `npm install` at the root re-runs a `postinstall`
hook that installs/updates the `ts/` toolchain — so after a `git pull` that changed
dependencies, just run `npm install` again. If you ever hit a "module not found" or
version-mismatch error (a stale `node_modules` after switching branches or pulling),
do a clean reinstall:

```sh
rm -rf node_modules ts/node_modules && npm install
```

**As an installed CLI (once published to npm):**

```sh
npx @foresthubai/workflow-cli open my.workflow.json     # no clone, no install
# or: npm i -g @foresthubai/workflow-cli  →  fh-workflow open my.workflow.json
```

See [`ts/workflow-cli`](ts/workflow-cli) for the full command reference and the
`--static` / `--dev` open modes.

**With Claude Code — the `workflow-generate` skill:** describe the workflow in plain
language and the skill writes the `*.workflow.json` and runs the validators for you.
Install it into any project with the [`skills`](https://github.com/vercel-labs/skills)
CLI, no clone required:

```sh
npx skills add ForestHubAI/edge-agents --skill workflow-generate
```

The skill validates by shelling out to the `fh-workflow` CLI, so install that too
(`npm i -g @foresthubai/workflow-cli`). Then just describe a workflow — e.g.
*"read a sensor every 10s and toggle a relay"* — and the skill generates and
validates the file for you.

## Features

- **Workflow engine** — typed graph runtime; nodes for LLM calls, hardware I/O, MQTT, web search, memory, control flow.
- **Multi-provider LLMs** — Anthropic, OpenAI, Google Gemini, Mistral, plus a local SLM provider for `llama.cpp` / `vLLM` / `Ollama` / any OpenAI-compatible endpoint.
- **Visual React Flow builder** — embeddable component or runnable as bundled SPA, with typed parameters and live validation.
- **Contract-typed wire format** — every API generated from `contract/*.yaml` for both Go and TypeScript; CI fails on schema drift.

## Local SLM provider

One process per model — the standard for `llama.cpp` and `vLLM` — each declaring its capabilities. The proxy routes requests by capability, so a workflow can use a chat SLM, an embedder, and a classifier in one pass without knowing where each one is hosted.

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

Declarable capabilities: `chat`, `embedding`, `classification`, `reasoning`, `vision`, `function_call`, `code`, `fine_tuning`. Any OpenAI-compatible HTTP endpoint works.

## Hardware and transports

- **GPIO** via `go-gpiocdev` (digital in/out, edge triggers)
- **ADC / DAC / PWM** via Linux character-device interfaces
- **UART / serial** via `go.bug.st/serial`
- **MQTT** via Eclipse Paho — topic-scoped channels for device-to-device messaging
- **Web search** as a pluggable node

Digital and analog signal types are first-class in the workflow contract.

## Tested targets

| Target                         | Status                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Raspberry Pi 5 (8 GB)          | ✅                                                                                             |
| NVIDIA Jetson Orin Nano (8 GB) | ✅                                                                                             |
| x86 NUC (16 GB)                | ✅                                                                                             |
| STM32MP25 (1 GB, Linux MCU)    | ✅                                                                                             |
| Bosch Rexroth ctrlX CORE       | ✅                                                                                             |
| Other Linux `amd64` / `arm64`  | Works, untested                                                                                |
| macOS `arm64` / `amd64`        | Supported (development)                                                                        |
| Bare-metal MCU (Cortex-M)      | Not supported by the Go engine. Contract is portable; dedicated MCU runtime is on the roadmap. |

## Architecture

A workflow is a directed graph of typed nodes — LLM call, hardware I/O, MQTT, memory, control flow, expressions — connected by edges with one of five types: `control`, `tool`, `agentTask`, `agentChoice`, `agentDelegate`. The engine interprets the graph as a state machine: wait for event → execute node → transition. The contract (`contract/*.yaml`) is the single source of truth — Go and TypeScript both regenerate from it, CI fails on drift.

See [`go/CLAUDE.md`](go/CLAUDE.md) and [`ts/CLAUDE.md`](ts/CLAUDE.md) for deeper architecture notes.

## Repository layout

| Path                                         | What it contains                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [`contract/`](contract)                      | OpenAPI 3.0.3 schemas — single source of truth for Go and TS.                                               |
| [`go/`](go)                                  | Engine binary, LLM proxy, hardware drivers, MQTT transport. Module `github.com/ForestHubAI/edge-agents/go`. |
| [`ts/workflow-core`](ts/workflow-core)       | `@foresthubai/workflow-core` — headless workflow model, validation, (de)serialization. No React.            |
| [`ts/workflow-builder`](ts/workflow-builder) | `@foresthubai/workflow-builder` — React canvas component.                                                   |
| [`ts/workflow-cli`](ts/workflow-cli)         | `@foresthubai/workflow-cli` — the `fh-workflow` CLI + the reference SPA it serves.                          |

## Releases

- **Go runtime** — tagged `go/vX.Y.Z`. `go get github.com/ForestHubAI/edge-agents/go@vX.Y.Z`. Current: `go/v1.0.1`.
- **TypeScript packages** — `@foresthubai/workflow-core`, `@foresthubai/workflow-builder`, and `@foresthubai/workflow-cli` ship in lockstep at the same version, published to public npm.
- **Container image** — multi-arch (`linux/amd64`, `linux/arm64`), distroless, nonroot, published to GitHub Container Registry.

See [RELEASING.md](RELEASING.md).

## Contributing

See [CONTRIBUTING](.github/CONTRIBUTING.md) and the [Code of Conduct](.github/CODE_OF_CONDUCT.md). Open an issue before any non-trivial change. Every contribution is accepted under a Contributor License Agreement that preserves the dual-licensing model.

## Security

Do not open public issues for security vulnerabilities. Use [GitHub private vulnerability reporting](https://github.com/ForestHubAI/edge-agents/security/advisories/new) or email **root@foresthub.ai**. See [SECURITY.md](.github/SECURITY.md) for scope and process.

## License

`edge-agents` uses a **two-tier license model** designed to make the wire format and the headless workflow model maximally reusable while keeping the engine and the visual builder protected under copyleft.

| Component                                                                          | License                             | Why                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`contract/`](contract) (OpenAPI schemas)                                          | **Apache-2.0**                      | Wire format. Third-party Python, Rust, or Java clients should be free to implement against it.                                            |
| [`ts/workflow-core`](ts/workflow-core) (headless model)                            | **Apache-2.0**                      | Workflow model and validation. Same reasoning — should be embeddable into any TypeScript/JavaScript project without copyleft friction.    |
| [`go/`](go) (engine, LLM proxy, drivers)                                           | **AGPL-3.0-only** or **commercial** | Keeps hosted "edge-agents as a service" offerings honest. For commercial use cases incompatible with AGPL, contact **root@foresthub.ai**. |
| [`ts/workflow-builder`](ts/workflow-builder) (React canvas)                        | **AGPL-3.0-only** or **commercial** | Same dual-license terms as the engine.                                                                                                    |
| [`ts/workflow-cli`](ts/workflow-cli) (`@foresthubai/workflow-cli` + reference SPA) | **AGPL-3.0-only** or **commercial** | Bundles the AGPL builder; same dual-license terms.                                                                                        |

For the AGPL components, the AGPL network clause applies — providing a modified version over a network requires making the corresponding source available to users of that service.

Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) and [NOTICE](NOTICE).

---

Built by [ForestHub](https://foresthub.ai) — the platform for embedded and edge AI agents.
