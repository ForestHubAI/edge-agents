# edge-agents

**The open-source runtime for embedded and edge AI agents.** Build, deploy, and run
LLM-powered agentic workflows on gateways, single-board computers, and industrial
edge devices — visually composed, contract-typed, runnable offline.

[![CI](https://github.com/ForestHubAI/edge-agents/actions/workflows/ci.yml/badge.svg)](https://github.com/ForestHubAI/edge-agents/actions/workflows/ci.yml)
[![Go Reference](https://pkg.go.dev/badge/github.com/ForestHubAI/edge-agents/go.svg)](https://pkg.go.dev/github.com/ForestHubAI/edge-agents/go)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
[![Commercial license](https://img.shields.io/badge/Commercial-license_available-brightgreen.svg)](#license)

`edge-agents` is the open core of the [ForestHub](https://foresthub.ai) platform:
a workflow **engine**, a multi-provider **LLM proxy** with first-class support
for **on-device small language models (SLMs)**, a language-neutral **OpenAPI
contract**, and a visual **workflow builder** — all of which run **standalone
and offline**, without any ForestHub-hosted service.

---

## What is edge-agents?

`edge-agents` is a workflow runtime that lets you compose AI agents from typed
nodes — LLM calls, hardware I/O, MQTT messages, web search, memory, control flow —
on a visual canvas, and execute the resulting graph on an embedded Linux device
or a server. It is purpose-built for **edge AI agents**: agents whose inputs and
outputs include the physical world (sensors, actuators, serial buses), not only
text and HTTP.

The runtime is a Go binary (~15 MB, distroless container, multi-arch
`linux/amd64` + `linux/arm64`). The visual builder is a React component library
that the bundled reference app embeds. Both sides share one **OpenAPI 3.0.3
contract** that defines the workflow format, so Go and TypeScript can never
silently drift.

ForestHub specializes in **embedded and industrial edge agent deployment** and
maintains this repository as the runtime layer of its broader platform. The
hosted control plane (multi-tenant governance, device fleets, deployment
auditing) is a separate commercial product that consumes this open core.

## Why edge-agents

Most agent frameworks assume a cloud-shaped world: an API call goes out, an LLM
responds, code runs in a container next to a database. The **edge** breaks every
one of those assumptions:

- **Connectivity is unreliable.** Service technicians work in basements; harvesters
  work in fields; ships work mid-Atlantic. An agent that needs the cloud for every
  step is unusable there.
- **Inputs and outputs are physical.** A GPIO pin, a 4–20 mA sensor, a CAN bus, a
  serial weighing scale. None of these are HTTP.
- **Latency is a constraint, not a metric.** Closing a control loop in 50 ms is
  fundamentally different from "p99 < 2 s".
- **Deployment is constrained.** You cannot ship a 4 GB Python environment to a
  thousand gateways across an industrial fleet.

`edge-agents` is the runtime that closes that gap: a single small Go binary, a
typed visual workflow format, and the option to call cloud LLMs **or** a fleet
of **small language models running on the device itself**.

## Features

- **Visual workflow builder** — React Flow-based canvas with typed nodes, ports,
  channels, and live validation. Embeddable as a React component or runnable via
  the bundled SPA.
- **Multi-provider LLM proxy** — one client, four cloud providers (Anthropic,
  OpenAI, Google Gemini, Mistral). Provider is dispatched implicitly from the
  model id; switching from cloud to on-device is a one-line change.
- **On-device SLM registry (Local provider)** — a typed multi-endpoint
  registry for **small language models** running on the same device as the
  engine (llama.cpp server, vLLM, Ollama, any OpenAI-compatible endpoint).
  Each model declares its capabilities (`chat`, `embedding`, `classification`,
  `reasoning`, `vision`, `function_call`, `code`, `fine_tuning`) and, for
  embedders, its output dimension. The proxy routes requests by capability,
  so an agent can use a 600 MB classifier and a 4 GB chat model from the same
  workflow without knowing where either is hosted.
- **Agent loop with tool use** — first-class tool calling and the
  `agentDelegate` edge type for multi-agent handoff.
- **Hardware I/O nodes** — GPIO, ADC, DAC, PWM, UART, serial. Native Linux
  drivers via `go-gpiocdev` and `go.bug.st/serial`. Digital and analog signal
  types are first-class in the workflow contract.
- **MQTT transport** — Eclipse Paho-based, with topic-scoped channels for
  device-to-device communication.
- **Memory primitives** — agent memory files, variable scoping, expression
  language for derived values.
- **Web search node** — pluggable, no hard provider lock-in.
- **Standalone mode** — the engine boots and runs workflows with **no backend,
  no account, no network call required**.
- **Strict contract typing** — every wire format is generated from
  `contract/*.yaml`. CI fails if the checked-in Go or TS bindings drift from the
  contract.
- **Distroless container, nonroot user** — a 15 MB image with no shell,
  no package manager, no root.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       contract/  (OpenAPI 3.0.3)                        │
│                       SOURCE OF TRUTH — Go and TS                       │
│                       both regenerate from here.                        │
└────────────────────────┬────────────────────────────────┬───────────────┘
                         │                                │
                  go generate                       npm run generate
                         │                                │
                         ▼                                ▼
┌─────────────────────────────────┐  ┌──────────────────────────────────┐
│            go/                  │  │              ts/                 │
│                                 │  │                                  │
│  cmd/engine    binary           │  │  workflow-core   headless model  │
│  engine/       state-machine    │  │  workflow-builder React canvas   │
│  llmproxy/     5 providers      │  │  app             reference SPA + │
│  driver/       GPIO/serial/I2C  │  │                  fh-builder CLI  │
│  transport/    MQTT             │  │                                  │
│                                 │  │                                  │
│  → engine binary (distroless)   │  │  → @foresthubai/workflow-core    │
│  → multi-arch container         │  │  → @foresthubai/workflow-builder │
└─────────────────────────────────┘  └──────────────────────────────────┘
```

| Path | What it contains | Released as |
| --- | --- | --- |
| [`contract/`](contract) | Language-neutral OpenAPI schemas: `workflow.yaml`, `engine.yaml`, `llmproxy.yaml`, `debug.yaml`. | Tagged with the repo, no separate artifact. |
| [`go/`](go) | Engine runtime, LLM proxy, drivers, MQTT, web search. Module `github.com/ForestHubAI/edge-agents/go`, Go 1.25. | Git tag `go/vX.Y.Z` + distroless container image. |
| [`ts/workflow-core`](ts/workflow-core) | Headless workflow model: types, (de)serialization, pure validator. No React, no DOM. | npm package `@foresthubai/workflow-core`. |
| [`ts/workflow-builder`](ts/workflow-builder) | React component library: the visual canvas/editor. | npm package `@foresthubai/workflow-builder`. |
| [`ts/app`](ts/app) | Reference SPA (Vite) and `fh-builder` CLI. | Not published; run from source. |
| [`skills/`](skills) | Claude Code skill wrapping the workflow CLI. | Not packaged separately. |

The Go and TypeScript trees are **independently buildable and releasable**. A
TypeScript contributor never needs the Go toolchain, and vice versa — only edits
to `contract/` touch both sides.

## Quickstart

### Run the engine — Docker (one command)

```sh
docker run --rm -p 8081:8081 \
  -e ENGINE_STANDALONE=true \
  ghcr.io/foresthubai/edge-agents/engine:latest
```

The engine starts in standalone mode (no backend, no account) and exposes its
HTTP API on `:8081`. POST a workflow to `/deploy`, hit `/heartbeat`, drive it
through the debug protocol.

### Run the engine — from source

```sh
cd go
go build ./cmd/engine    # produces ./engine
./engine                 # reads config from ENGINE_* env vars
```

Requires the Go version pinned in `go/go.mod`.

### Open the visual builder

```sh
cd ts
npm ci
npm run build
cd app && npm run dev    # http://localhost:5173
```

The reference SPA embeds `@foresthubai/workflow-builder` — the same canvas
component you can install in your own React application.

### Validate a workflow from the CLI

```sh
cd ts/app
npm run validate -- ../../examples/hello-world.workflow.json
# exit 0 → clean; exit 1 → diagnostics JSON on stdout
```

The `fh-builder validate` command is also wrapped by the
[`workflow-validate`](skills/workflow-validate) Claude Code skill.

## Use cases

The following are the agent shapes the runtime is designed around. None of them
require any ForestHub-hosted service.

- **Service-technician assistant on a rugged tablet.** Offline-capable LLM
  workflow that walks a technician through a diagnostic procedure, reads sensors
  over BLE/serial, and logs results to MQTT when connectivity returns.
- **Predictive-maintenance agent on a gateway.** Streams sensor data, calls an
  LLM only when an anomaly crosses a threshold, escalates to a human via a
  `tool` edge.
- **Industrial control loop with reasoning escalation.** Real-time control runs
  in deterministic nodes; the LLM is invoked as a `tool` only at decision
  boundaries (e.g. "should I keep running given this fault pattern?").
- **Hardware-in-the-loop test agent.** Drives GPIO/serial against a device
  under test, summarizes runs in natural language, files structured bug
  reports.
- **MQTT-orchestrated multi-agent setups.** `agentDelegate` edges let one
  agent hand work to another across an MQTT topic — useful for split
  edge/cloud deployments where heavy reasoning runs in a datacenter and
  lightweight policy runs on the device.

## Where it runs

| Target | Status | Notes |
| --- | --- | --- |
| Linux `amd64` server | Supported | Distroless container or static binary. |
| Linux `arm64` SBC (Raspberry Pi 4/5, NVIDIA Jetson Orin, similar) | Supported | Multi-arch container via `docker buildx`. |
| Linux `arm64` industrial gateway | Supported | Tested in field deployments. |
| macOS (`arm64` / `amd64`) | Supported (dev) | For local development and the builder. |
| Windows | Engine: untested; builder: works (web app). | Containers via Docker Desktop. |
| Bare-metal MCU (Cortex-M) | Not supported by the Go engine. | A dedicated MCU runtime is on the ForestHub roadmap; the workflow contract is portable. |

## LLM providers

| Provider | Models tested | Configuration |
| --- | --- | --- |
| **Anthropic** | Claude Sonnet, Claude Opus | `ANTHROPIC_API_KEY` |
| **OpenAI** | GPT-4o, GPT-4 family, GPT-3.5 | `OPENAI_API_KEY` |
| **Google Gemini** | Gemini 2.0/2.5 family (Vertex AI or AI Studio) | `GEMINI_API_KEY` / Vertex AI service account |
| **Mistral** | Mistral Large, Mistral Small, Codestral | `MISTRAL_API_KEY` |
| **Local (on-device SLMs)** | Any model served by `llama.cpp` / `llama-server`, `vLLM`, `Ollama`, `LM Studio`, or any OpenAI-compatible endpoint — typically small specialized models (Llama 3 8B, Qwen 2.5, Phi-3.5, Gemma 2, `nomic-embed-text`, `bge-*`, classifiers, …) | Typed YAML registry (see below) |

Provider routing is implicit from the model id — there is no manual provider
field. Switching from cloud to a local SLM is a one-line model-id change.

## Small language models on-device

Edge agents are SLM-shaped. A 70B model in a datacenter is overkill for "classify
this sensor reading" or "summarize this maintenance log" — and unreachable from a
basement service call anyway. `edge-agents` treats **on-device small language
models as a first-class peer to cloud LLMs**, not as a fallback.

The **Local provider** is a typed registry, not a single endpoint:

```yaml
# local-models.yaml
endpoints:
  - url: http://localhost:8080            # llama-server hosting a chat SLM
    models:
      - id: llama-3.1-8b-instruct
        label: "Llama 3.1 8B (chat)"
        capabilities: [chat, reasoning, function_call]
        tokenModifier: 1.0
  - url: http://localhost:8081            # llama-server hosting an embedder
    models:
      - id: nomic-embed-text-v1.5
        label: "Nomic Embed v1.5"
        capabilities: [embedding]
        dimension: 768
  - url: http://localhost:8082            # vLLM serving a small classifier
    models:
      - id: distil-classifier
        capabilities: [classification]
```

What this buys you:

- **Capability routing.** A workflow node that asks for `embedding` reaches the
  embedder; an agent asking for `chat` reaches the chat SLM. No manual wiring
  of endpoints in the workflow itself.
- **One-process-per-model is the supported topology.** Most edge SLM stacks
  (`llama.cpp`, `vLLM`) serve one model per process; the registry models this
  directly rather than pretending a single endpoint hosts everything.
- **Vector-DB compatibility.** Each embedding model declares its
  `dimension` — surface a 384-dim and a 768-dim embedder side by side without
  silently corrupting an index.
- **Offline by construction.** Combined with the engine's local mode (no
  control plane, filesystem-backed memory, no-op RAG fallback), a device can
  boot, load a workflow, call its own SLMs, and run without ever touching the
  network.

This pattern — **a small fleet of narrow, specialized models on the device
itself, orchestrated by a typed workflow** — is what we mean by *edge AI
agents*.

## How does edge-agents compare?

`edge-agents` is purpose-built for one job: **running typed agent workflows on
edge devices, with hardware I/O as a first-class concept**. It is not trying to
replace general-purpose agent frameworks for cloud-only workloads.

| Tool | Primary target | Hardware I/O | Visual canvas | Self-hostable | LLM-provider neutral |
| --- | --- | --- | --- | --- | --- |
| **edge-agents** | Edge devices, gateways, SBCs | First-class (GPIO/ADC/DAC/PWM/UART/MQTT) | Yes | Yes | Yes (5 providers) |
| LangGraph / LangChain | Cloud Python services | No | No | Yes | Yes |
| n8n | Cloud / self-hosted automation | Via REST/MQTT nodes, no hardware nodes | Yes | Yes | Yes |
| Dify | Cloud LLM apps | No | Yes | Yes | Yes |
| Make / Zapier | Cloud SaaS automation | No | Yes | No | Indirect |

If you need to read a sensor, decide with an LLM, and pull a relay — on a device
that may be offline — `edge-agents` is built for that. If you need to orchestrate
a hundred-step SaaS workflow in the cloud, the tools above will serve you better.

## The contract is the source of truth

The single highest technical risk in a polyglot runtime is **schema drift**
between the Go server and the TypeScript client. `edge-agents` solves this by
elevating the OpenAPI contract to the only authority:

- All wire formats live in [`contract/*.yaml`](contract).
- Go bindings are regenerated by `go generate ./...` into `go/api/**/*.gen.go`.
- TypeScript bindings are regenerated by `npm run generate` into
  `ts/workflow-core/src/api/workflow.ts`.
- **Generated files are committed.** A diff after regeneration is a CI failure.
- A contract change is always a three-step edit: edit the YAML, regenerate Go,
  regenerate TS — then reconcile the hand-written domain code on each side.

This is enforced by a dedicated CI job, not a convention. See
[`CLAUDE.md`](CLAUDE.md), [`go/CLAUDE.md`](go/CLAUDE.md), and
[`ts/CLAUDE.md`](ts/CLAUDE.md) for the full per-language conventions.

## About ForestHub

[ForestHub.ai](https://foresthub.ai) builds the platform for **embedded and
edge AI agents** — visual agent design, deployment to constrained devices, and
fleet operations for industrial environments. `edge-agents` is the open-source
runtime layer; the hosted control plane (multi-tenant governance, device
fleets, deployment auditing, version management) is a separate commercial
offering that consumes this repository.

## FAQ

### What is an edge AI agent?

An edge AI agent is an LLM-driven workflow that runs on a device near the data
source — a gateway, a single-board computer, an industrial controller — rather
than in a cloud datacenter. It typically combines language-model reasoning with
direct sensor and actuator access, and is expected to operate during temporary
connectivity loss.

### What is ForestHub edge-agents?

`edge-agents` is the open-source runtime that ForestHub uses to execute agent
workflows on edge devices. It includes a Go engine, a multi-provider LLM proxy,
a visual workflow builder, and a language-neutral OpenAPI contract. The
repository is released under AGPL-3.0 with a separate commercial license
available for use cases incompatible with the AGPL.

### Can I use edge-agents without ForestHub's hosted platform?

Yes. The engine boots in standalone mode with no backend, no account, and no
outbound calls beyond LLM provider APIs (which you can also self-host). The
ForestHub hosted control plane is optional — it adds fleet management,
multi-tenancy, and deployment auditing on top of the same engine.

### Does edge-agents run on a Raspberry Pi?

Yes — on Raspberry Pi 4 and 5, and on comparable `arm64` Linux SBCs. The
distroless container image is multi-architecture (`linux/amd64` and
`linux/arm64`). The Go binary itself is around 15 MB and has no runtime
dependencies beyond a Linux kernel.

### Does edge-agents run on microcontrollers?

The Go-based engine does not run on bare-metal MCUs (Cortex-M class). The
workflow contract itself is portable, and a dedicated MCU runtime is on the
ForestHub roadmap.

### Which LLM providers does edge-agents support?

Four cloud providers — Anthropic, OpenAI, Google Gemini, Mistral — plus a
**Local provider** that fronts a typed registry of on-device small language
models (any model served by `llama.cpp`, `vLLM`, `Ollama`, `LM Studio`, or any
OpenAI-compatible endpoint). The provider is dispatched implicitly from the
model id, so switching between a cloud LLM and a local SLM is a one-line
change.

### Can edge-agents run small language models (SLMs) on the device?

Yes — this is a primary use case, not a fallback. The Local provider is a
typed multi-endpoint registry: each model declares its capabilities
(`chat`, `embedding`, `classification`, `reasoning`, `vision`,
`function_call`, `code`, `fine_tuning`) and, for embedders, its output
dimension. The proxy routes requests by capability, so an agent can use a
small classifier, an embedder, and a chat SLM in the same workflow without
knowing where each one is hosted. Combined with the engine's local mode
(filesystem-backed memory, no-op control-plane lifecycle), this gives you a
fully offline agent on a single device.

### How is edge-agents different from LangGraph or n8n?

LangGraph is a Python agent framework optimized for cloud services and shares
no runtime concerns with the edge — no hardware I/O, no offline mode, no native
binary. n8n is a general-purpose automation platform with a visual editor but
no first-class hardware nodes and no edge deployment story. `edge-agents` is
designed for the case where the agent's inputs and outputs include the physical
world and the network may be intermittent.

### Is edge-agents free for commercial use?

Yes, under the terms of AGPL-3.0 — including its requirement to make the
complete corresponding source available to users who interact with a modified
version over a network. For commercial use cases that are incompatible with
the AGPL (for example, a closed-source product that embeds `edge-agents`
without releasing its source), ForestHub offers a separate commercial license.
Contact **root@foresthub.ai**.

### Why AGPL and not MIT or Apache?

AGPL keeps the runtime open across network deployments while making sustaining
ForestHub's development of it commercially viable. Adopters who need
permissive terms can purchase a commercial license; everyone else gets a
strong, free, source-available runtime under a well-understood OSI-approved
license.

### Can I contribute?

Yes — see [CONTRIBUTING](.github/CONTRIBUTING.md). Bug reports, feature
requests, and well-scoped pull requests are welcome. For larger changes, open
an issue first to align on direction. Every contribution is accepted under a
Contributor License Agreement that preserves the dual-licensing model.

## Releases

- **Go runtime** — tagged as `go/vX.Y.Z` in this repository. Consumers pin with
  `go get github.com/ForestHubAI/edge-agents/go@vX.Y.Z`. Current: `go/v1.0.1`.
- **TypeScript packages** — `@foresthubai/workflow-core` and
  `@foresthubai/workflow-builder` ship in lockstep at the same version.
- **Container image** — multi-arch (`linux/amd64`, `linux/arm64`), distroless,
  nonroot, published to GitHub Container Registry.

Full release mechanics, including the rationale for orthogonal Go and npm
versioning, are documented in [RELEASING.md](RELEASING.md).

## Contributing

We welcome contributions. Please read:

- [CONTRIBUTING](.github/CONTRIBUTING.md) — development setup, coding
  conventions, the contract rule, and the Contributor License Agreement.
- [Code of Conduct](.github/CODE_OF_CONDUCT.md) — Contributor Covenant 2.0.

For anything more than a small fix, **open an issue first** so we can align
before you invest time. APIs are still moving; coordination saves work.

## Security

Please do **not** open public issues for security vulnerabilities. Report them
via [GitHub private vulnerability reporting](https://github.com/ForestHubAI/edge-agents/security/advisories/new)
or by email to **root@foresthub.ai**. See [SECURITY.md](.github/SECURITY.md)
for scope and process.

## License

`edge-agents` is **dual-licensed**:

- The public release is distributed under the
  [GNU Affero General Public License v3.0](LICENSE) (`AGPL-3.0-only`). You may
  use, study, modify, and redistribute it under those terms — including the
  AGPL's requirement to make the complete corresponding source available to
  users who interact with a modified version over a network.
- For use cases that are incompatible with the AGPL (for example, building a
  proprietary product or service on top of `edge-agents` without releasing your
  own source), ForestHub offers a separate **commercial license**. Contact
  **root@foresthub.ai**.

This is a *source-available, commercial open-source* model — not a permissive
license. Third-party components retain their own licenses; see
[THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) and [NOTICE](NOTICE).

Contributions are accepted under a Contributor License Agreement that preserves
this dual-licensing model — see
[CONTRIBUTING § License and Contributor Agreement](.github/CONTRIBUTING.md#license-and-contributor-agreement).

---

**Built by [ForestHub](https://foresthub.ai)** — the platform for embedded and
edge AI agents.
