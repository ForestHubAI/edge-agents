# fh-agent

Compile a `site.spec.yaml` into a deploy-ready edge-agent bundle for
Raspberry Pi, NVIDIA Jetson, x86 NUC, ST STM32MP25, or Bosch Rexroth
ctrlX CORE.

Mental model: this is a **compiler** for edge-AI sites. Source is
`site.spec.yaml`; target is a Docker Compose stack you `scp` to a device
and `docker compose up`.

```
site.spec.yaml  ─ plan ─▶  build/  ─ validate ─▶  build/  ─ build ─▶  dist/<name>/
   (durable)         (compiled graph,                 (cross-checks)       (compose
                      mapping, manifest,                                     stack)
                      local-models)
```

## Install

```sh
cd go
go install ./cmd/fh-agent
```

## The four passes

| Pass | Reads | Writes | Network? | Determ? |
| --- | --- | --- | --- | --- |
| `spec`     | site.spec.yaml          | (echo + lint) | no | — |
| `plan`     | site.spec.yaml + target | build/        | no | **yes** |
| `validate` | build/                  | diagnostics   | no | yes |
| `build`    | build/                  | dist/\<name\>/ | no | yes |

`plan` is the heart. It MUST be byte-deterministic for the same spec +
target — otherwise an iterating agent sees diff noise. Stable node ids
(SHA256 of `name|type|disc`), sorted keys, no timestamps.

## Subcommands

### Authoring

- `fh-agent spec init [--out site.spec.yaml]` — emit a commented template
- `fh-agent spec schema [--json]` — emit JSON Schema (draft 2020-12) for
  programmatic priming of an LLM agent
- `fh-agent spec validate <spec.yaml>` — required fields, dangling refs,
  bus/device consistency

### Introspection (the CLI doubles as docs for agents)

- `fh-agent targets list` — embedded hardware profiles
- `fh-agent targets describe <id>` — RAM, GPIO/serial map, supported SLMs
  with estimated tok/s
- `fh-agent capabilities` — bus types, device kinds, LLM capabilities
- `fh-agent models suggest --target <id> --capability <cap>` — best-fit
  models for the target, RAM-filtered, sorted by smallest fit

### Compilation

- `fh-agent plan <spec.yaml> --target <id> [--out build/]`
- `fh-agent validate <build-dir>`
- `fh-agent build <build-dir> --name <site-name> [--out dist/] [--tar]`

## Hardware targets (v1)

| ID | Arch | RAM | Accel | Notes |
| --- | --- | --- | --- | --- |
| `rpi5-8gb` | arm64 | 8 GB | none | General-purpose SBC |
| `jetson-orin-nano-8gb` | arm64 | 8 GB | CUDA (40 TOPS) | Vision-language / 7B models |
| `x86-nuc-16gb` | amd64 | 16 GB | Iris Xe iGPU | RAG / heavy reasoning |
| `stm32mp25-1gb` | arm64 | 1 GB | Neural-ART NPU | Sensor fusion + classification |
| `ctrlx-core-arm64` | arm64 | 2 GB | i.MX 8M Plus NPU | Industrial controller, ctrlX OS |

Profiles live in `targets/*.yaml` and are embedded into the binary. Edit
those files to add models, change estimates, or add targets.

## Bundle layout

```
dist/<name>/
  compose.yml              # engine + llama-server + (optional) mosquitto
  agent.workflow.json      # binding-free graph
  site.mapping.json        # channels → platform resources
  site.resources.yaml      # mqtt brokers etc.
  device.manifest.json     # gpios/serials of this device
  local-models.yaml        # local SLM registry
  bundle.meta.json         # fh-agent metadata
  .env.example             # API-key template
  models/                  # weights live here (download separately)
  README.md                # auto-generated, run instructions
```

## How an agent uses this

```
$ fh-agent spec init --out site.spec.yaml
$ fh-agent spec schema --json                  # prime on the format
# (agent interviews user, edits site.spec.yaml)
$ fh-agent spec validate site.spec.yaml        # exit 1 + JSON diags
# (agent fixes)
$ fh-agent targets list --json
$ fh-agent targets describe rpi5-8gb --json    # RAM, SLMs available
$ fh-agent plan site.spec.yaml --target rpi5-8gb --out build/
$ fh-agent validate build/
$ fh-agent build build/ --name muellers-haus --tar
# → dist/muellers-haus/ + dist/muellers-haus.tar.gz
```

## Output contract for agents

- **All commands emit JSON** on stdout when `--json` (default for
  introspection/diagnostic commands). Status messages go to stderr.
- **Diagnostics shape** is identical across commands:
  ```json
  {"severity": "error|warn|info", "category": "spec|plan|validate|build",
   "message": "...", "location": "$.devices[2].bus.topic", "nodeId": "..."}
  ```
- **Exit codes**:
  - `0`  ok
  - `1`  diagnostics (user-correctable)
  - `2`  infrastructure (IO error, embedded data corrupted)
  - `64` usage error
- **Stable output**: same spec + target ⇒ byte-identical artifacts. Map
  keys sorted, node ids hashed from inputs, no timestamps.

## v1 known limits (documented; not bugs)

- **Workflow schema** is structurally compiled but **not** validated
  against `contract/workflow.yaml`. Run `fh-workflow validate` (from the
  TypeScript CLI) for that. Plan is to call it as a subprocess in v1.1.
- **Bus types** in spec: `mqtt`, `gpio`, `serial`. I2C, SPI, HTTP, and
  ctrlX Data-Layer adapters are deferred.
- **No provisioning, no OTA, no HIL**. v1 stops at the bundle. v2 adds
  `fh-agent deploy --to pi@host`.
- **Model weights** are not downloaded — `models/` is empty; the README
  in the bundle has a hint pointing at Hugging Face for common models.

## Testing

```sh
go test ./cmd/fh-agent/...
```

Three suites: determinism (same input → same bytes across all 5
targets), target-fit (chosen model fits target RAM), and validate
catches a mangled bundle.
