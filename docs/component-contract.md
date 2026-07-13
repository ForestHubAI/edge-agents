# Component contract: how a container behaves on a device

Every ForestHub component — the engine, camera, ml-inference, llama-server, and any
custom container you co-deploy — runs as one Docker container on the device and obeys
the same small runtime contract: **how it is named, where it reads config and secrets,
where it keeps durable data, how it reports a fatal boot failure, and where its logs
go.** This is what a component author codes against; it is OS- and renderer-independent.

This doc is prose over the machine source of truth. The literal values live in
[`contract/component-constants.json`](../contract/component-constants.json), with
enforced twins in every language:

| Language | File | Guard |
| --- | --- | --- |
| Go | [`go/component/constants.go`](../go/component/constants.go) | `constants_test.go` |
| TS | [`ts/workflow-core/src/deploy/constants.ts`](../ts/workflow-core/src/deploy/constants.ts) | `constants.test.ts` |
| Python | [`py/ml-inference/app/config.py`](../py/ml-inference/app/config.py) | `tests/test_constants.py` |

Changing a value means editing the JSON **and** all three twins in lockstep; the
per-language tests fail if they drift.

> This is the **in-container** contract only. How the renderer lays out the *host*
> filesystem, provisions bind mounts, and pulls artifacts is a separate concern —
> see [`deployment-pipeline.md`](./deployment-pipeline.md). The component never sees
> the host layout; it only ever reads the fixed in-container paths below.

## Identity is the container name

A component's identity is its **container name** — the compose service name the
renderer assigns. That single string is how the control plane addresses it, how other
components reach it over the network, and the tag its logs are correlated by. There is
no separate identity record.

The first-party components each have a fixed, canonical name:

| Component | Container name |
| --- | --- |
| Engine | `engine` |
| Camera | `camera` |
| ML inference | `ml-inference` |
| llama-server | `llama-server` |

Each is a **singleton** — one container. llama-server hosts *many* on-device models in
that one container: llama-swap fronts them behind a single endpoint and the engine
selects a model by id per request. So its name is fixed like the rest, not one container
per model. Custom components pick their own unique name (see
[`components/README.md`](../components/README.md)).

> The name must be **stable across deployments**. It keys the durable workspace
> (below): a name that churns between deploys orphans the old workspace and starts the
> component on an empty one.

## The three in-container paths

The renderer bind-mounts a per-container host directory onto each of these fixed paths.
The component opens exactly these paths — never a host path, never an env-tunable
location:

| Path | Mode | Consumed via | Holds |
| --- | :--: | --- | --- |
| `/etc/foresthub/config.json` | ro | `component.ConfigFile` | the boot config (component-specific shape) |
| `/etc/foresthub/secrets.json` | ro | `component.SecretsFile` | resolved id-keyed credentials, refreshed every deploy |
| `/var/lib/foresthub/workspace` | rw | `component.Workspace` | durable working data, persisted across deploys |

These are **constants, not configuration**: their values *are* the renderers' mount
targets. A component that reads a different path reads an unmounted, empty location.

Not every component uses all three — a component reads only the paths it needs, and
the renderer mounts only those (see the per-component table below).

### `config.json` — the boot config

`config.json` is the component's frozen boot config, read once at startup. Its **shape
is per-component**, and follows the repo's seam rule (see the root `CLAUDE.md`): a
config that a second implementation — a renderer in another language, or the backend —
must independently produce gets a schema in the component's own `contract/*.yaml` and
is code-generated on both sides; a config only one implementation ever touches stays a
plain domain type documented in that language.

| Component | `config.json` shape | Seam |
| --- | --- | --- |
| Engine | `EngineConfig` — [`contract/engine.yaml`](../contract/engine.yaml) | contracted (backend produces it) |
| Camera | `CameraConfig` — [`contract/camera.yaml`](../contract/camera.yaml) | contracted (the renderer writes it, Go reads it) |
| llama-server | a models list in `config.json`, fronted by llama-swap | image-owned — the entrypoint defines and reads the shape (a bash consumer, no codegen), like ml-inference's manifest |
| ML inference | **none** — reads no `config.json`; configured by env (`ML_MODELS_DIR`) + the mounted model repository | domain-only |

A missing or malformed `config.json` on a component that requires it is a **permanent**
boot failure — exit `ExitConfigError` (below), not a retry.

### `secrets.json` — resolved credentials

Dynamic, id-keyed credentials (MQTT passwords, network-model keys) that must **not**
live in the versioned deployment spec. They are resolved fresh on each deploy and
delivered here as a flat `map<id, string>`, mounted read-only exactly like `config.json`.
Absent when no external resource needs a secret. Fixed-name scalar secrets (provider
API keys, the engine secret) arrive as **environment variables** instead, not in this
file — see [`deployment-pipeline.md`](./deployment-pipeline.md) for the split.

### `workspace` — durable state

The device-authoritative working directory: engine memory files, model weights, a
model repository, broker durable state. It **persists across deployments** (keyed by
the container name) and is the component's local storage — local file I/O, no network
call, no credential. Config is restorable from the spec; the workspace is not, which is
the line between the two.

## Exit codes: how a component reports a fatal boot

A component tells the orchestrator how to react to a fatal failure through its **process
exit code**. Only a *permanent* failure gets a dedicated code; everything else is
transient.

| Exit | Meaning | Orchestrator reaction |
| :--: | --- | --- |
| `0` | clean shutdown | done |
| `78` | **permanent config error** (`ExitConfigError`, sysexits `EX_CONFIG`) — a restart fails identically | mark the deployment failed; **stop retrying** |
| any other nonzero | transient failure — may clear on a later start | may restart the container |

In Go, components go through [`go/component/boot`](../go/component/boot/boot.go) rather
than exiting by hand:

- `boot.Fail(err, msg)` — a permanent config failure. Exits `78`.
- `boot.Retry(err, msg)` — a transient failure. Exits `1`; the orchestrator may restart.

Both emit the failure line to stdout before exiting. Non-Go components mirror the same
numbers: ml-inference exits `78` (`EXIT_BAD_CONFIG`) on an empty or broken model
repository; a wrapped custom component exits `78` on a permanent config error (see
[`components/README.md`](../components/README.md)).

## Logging: structured JSON to stdout

A component writes structured JSON logs to **stdout** and does nothing else — no file
sink, no log shipper, no rotation. The container runtime captures the stream, and a
reader routes it: **Ranger** in the hosted path, `docker logs` or a collector in OSS.

A component **stamps no producer identity** on its lines. A log line is identified by
the *stream it is read from* (the container it came out of), not a field it carries — so
the component never needs to know its own container name or deployment id. In Go this is
the [`go/logging`](../go/logging) package: `logging.Configure(cfg)` sets the stdout
level once at boot (default `info`), and the shared `logging.Logger` is used everywhere
thereafter.

## Changing the contract

The paths, the exit code, and the singleton names are cross-language. To change one:

1. Edit [`contract/component-constants.json`](../contract/component-constants.json).
2. Update the three language twins (Go / TS / Python) to match.
3. Update every renderer's mount targets in lockstep — a path is only half of a bind
   mount; the renderer owns the other half.

The per-language `constants` tests fail on any drift between the JSON and a twin.
