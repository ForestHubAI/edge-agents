# fh-agent roadmap

The plan for the CLI that turns a `site.spec.yaml` into a deployable
edge-agent bundle. Owned by this directory; updated when scope changes.

## Principles

- **Compiler model, not orchestrator.** Source = spec + target; output =
  bundle. The CLI does not run the agent or hold state.
- **Deterministic.** Same inputs ⇒ byte-identical outputs. Agents diff
  outputs across runs to detect progress.
- **JSON-first.** Every diagnostic and listing is machine-readable.
- **No interactive prompts.** Agents drive this thing.
- **Resilient.** Optional tools (fh-builder, docker) degrade to a warn —
  the binary stays usable on a customer device with nothing but glibc.

## Shipped

### v1.0 — `site.spec.yaml` → deployable bundle (commit `b4a3150`)

- Four-phase pipeline: `spec` / `plan` / `validate` / `build`
- 5 embedded hardware target profiles
  (`rpi5-8gb`, `jetson-orin-nano-8gb`, `x86-nuc-16gb`, `stm32mp25-1gb`,
  `ctrlx-core-arm64`)
- Spec schema + JSON-Schema export for agent self-priming
- Deterministic plan compile (hashed node ids, sorted keys)
- Model auto-selection (capability ∩ RAM fit) per target
- Compose-stack bundle: official engine image + llama-server sidecar
  + optional mosquitto + configs + auto-README + `.env.example` +
  optional `.tar.gz`
- Cross-validation: channels ↔ mapping ↔ resources ↔ manifest
- Go-side tests: determinism on all 5 targets, RAM-fit, mangle-catch

### v1.1 — Contract-schema validation (commit `0fb4ef9`)

- `fh-builder validate --json` (TS) emits machine-readable diagnostics
- Subprocess integration in `fh-agent validate`; warn-fallback if
  `fh-builder` is missing
- Plan fixes uncovered by the new check (Ticker units, pinReference,
  agentTask edge `prompt`, expression literal defaults)

## Open — v1.x (hardening, small surface)

Ordered by ratio of (value / effort). Pick from the top.

| | Why it matters | Sketch |
| --- | --- | --- |
| **Real-device smoke test on a Pi5** | Every v1 guarantee is theoretical until one bundle has actually booted on real hardware. | Take the muellers-haus example, scp, `docker compose up`, attach a fake MQTT publisher, watch the agent loop. |
| **CI: `go test ./cmd/fh-agent/...`** | Determinism + RAM-fit + validate-catch already exist as tests; just wire them into `.github/workflows/`. | Add a step to the existing CI workflow file. |
| **Claude skill wrapper in `skills/agent-build/`** | Makes the CLI discoverable to Claude Code (mirrors how `workflow-validate` wraps `fh-workflow validate`). | One `SKILL.md`, points at `fh-agent plan / validate / build`. |
| **`fh-agent doctor`** | Pre-flight check on the bundle host: engine reachable, llm endpoint up, GPIO permissions, model file present. Saves support roundtrips. | New subcommand; reuses `loadMetadata` + a few `http.Get` / `os.Stat`. |
| **Model-download helper** | Today `models/` ships empty and the README points at Hugging Face manually. Either an init-container in the compose stack, or `fh-agent build --pull-model`. | Curated GGUF URL table per target catalog; SHA verification. |
| **Spec-schema JSON publishable** | The schema export is the primary primer for an external Claude agent. Ship it as a versioned URL (e.g. `https://schemas.foresthub.ai/site.spec.v1.json`) so prompts can reference it stably. | Wire `fh-agent spec schema` into a build artifact, host on cloudflare. |

## Open — v2 (new phases, bigger scope)

| Phase | What it unlocks |
| --- | --- |
| **`fh-agent deploy --to pi@host`** | Closes the manual gap between bundle and running agent. SSH/scp or Balena, then `docker compose up` remotely. Bring-your-own-key auth. |
| **HIL test harness** | `scenarios.test.yaml` + a runner that publishes synthetic MQTT events, waits, asserts on actuator topics. Safety-critical for buildings (heating must not switch off). The skeleton file already ships in v1 bundles. |
| **Bus-type expansion: I2C / SPI / HTTP / ctrlX Data-Layer** | Unlocks STM32MP25 ADC/DAC and full ctrlX CORE use-cases. Requires matching channel types in `contract/workflow.yaml`. |
| **Constraint enforcement** | Today, `constraints[]` flow into the agent prompt as text. v2 generates structural guards (`If` nodes with min/max) in front of each `WritePin` / `MqttPublish` so the agent *can't* violate them. |
| **Diff-deploy / OTA** | Spec edit ⇒ only the delta is pushed to the engine. Needs `fh-backend` and engine versioning protocol. |
| **Vision + function-call capabilities** | Real tool schemas (not just descriptions), vision-language models for camera-fed sensors. New target capability flags. |
| **More targets** | Variscite VAR-SOM, Toradex Verdin, Siemens IPC, BeagleY-AI. Each is a single YAML in `targets/`. |

## Out of scope

Intentionally not in this CLI — belongs elsewhere:

- **Workflow editing UI** — that is `fh-builder open`.
- **Multi-tenant control plane** — `fh-backend`, closed source.
- **Agent runtime tracing** — engine emits structured logs; consume them
  from `fh-backend` or a Grafana dashboard, not from this CLI.
- **Natural-language → spec generation** — that is the agent's job. The
  CLI compiles what the agent produced.
