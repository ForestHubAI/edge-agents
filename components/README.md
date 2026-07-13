# Custom components

`fh-workflow deploy` runs the engine (and a llama-server hosting your on-device
models) for you. A **custom component** is any extra container you co-deploy alongside them —
a dashboard, an MQTT broker, a metrics exporter — that the workflow graph does not
summon. You author it; the wizard merges it in and renders it exactly like the
first-party components.

You hand the wizard a **folder**, via `--component <dir>` (repeatable) or the
interactive prompt. It reads at most **two files** from that folder:

| File | Required | Role |
| --- | :--: | --- |
| `component.json` | yes | A `DeployComponent` (see `contract/deployment.yaml`), merged verbatim into the spec. Validated against the contract — unknown or misspelled keys are rejected. |
| `<name>.env.example` | no | Env template for the operator's values. The wizard turns it into `<name>.env` in the bundle. |

Nothing else in the folder is read. Building the image is **your** job, offline —
the wizard never builds anything (just as the engine image is built by hand).

Whatever the image does, it runs under the same runtime contract as the first-party
components — the container name, the fixed config/secrets/workspace paths, the exit
codes, and stdout logging. That contract is [`docs/component-contract.md`](../docs/component-contract.md);
this guide is the authoring side of it.

This folder holds two worked examples at opposite ends of the effort spectrum:
[`grafana/`](./grafana) (no image build) and [`llama-server/`](./llama-server)
(a thin wrapper image). Both are walked through under
[Worked examples](#worked-examples) below.

## Three ways to configure your component

Pick whichever your image already supports — they are not exclusive:

1. **`command`** — CLI flags, frozen in the spec (`"command": ["--port", "8080"]`).
   Best for servers configured entirely by flags (llama-server, many exporters).
2. **env** — a `<name>.env.example` of `KEY=value` lines. Best for images that read
   their settings from environment variables (Grafana's `GF_*`, Postgres's `POSTGRES_*`).
3. **native JSON `config`** — a `config` object, rendered to a JSON file and
   bind-mounted at the fixed path `/etc/foresthub/config.json`. Only useful if your
   image already reads JSON from that path (otherwise add a thin entrypoint that
   symlinks it to where your image expects).

## The `<name>.env.example` convention

The file is a key list **and** a default source. Per line:

- `KEY=value` → a default; taken silently (use for non-secret tunables).
- `KEY=` (empty) → prompted at a terminal, left blank otherwise (use for secrets).
- `# comment` / blank → passed through into the generated `<name>.env`.

The generated `<name>.env` is written mode `0600` and attached to the service as an
optional `env_file`. **Leave secrets empty here** — `<name>.env.example` is
committable, `<name>.env` is device-local and never committed. A component with no
secrets needs no `<name>.env.example` at all.

## When your image speaks neither flags, env, nor JSON

If your image reads some other format (an INI file, a bespoke config), none of the
three paths fits directly. You then build a **thin wrapper image**: a small
`Dockerfile` whose entrypoint translates one of the above into what your app wants,
then `exec`s it. That is ordinary image authoring, done by you, **outside** the
wizard — the wizard only ever consumes the resulting `image` tag. Keep the
conversion in the image; the spec stays generic.

To wrap **any** non-Go component whose config format ForestHub doesn't emit natively:

1. `FROM` a stock image that already contains your binaries — don't rebuild them.
2. Add a small `entrypoint.sh` that reads `/etc/foresthub/config.json` and translates
   it into whatever your app wants (a file, flags, an env dump), then `exec`s the app.
3. Obey the runtime contract like any component — log to **stdout** (add no shipper)
   and exit **78** on a permanent config error so the orchestrator stops retrying. The
   full rules live in [`docs/component-contract.md`](../docs/component-contract.md).
4. Publish an immutable tag and pin it.

A bundled MQTT broker (mosquitto) is a typical custom component: stock image, a
published port, a config file or env for its listener/auth — co-deployed so a
workflow's MQTT channels have a broker to reach.

## Worked examples

### `grafana/` — the no-build, env-only case

A local dashboard on the device: stock `grafana/grafana` brought in untouched.
Grafana is fully configured through `GF_*` env vars, so the whole component is a
`component.json` plus a `grafana.env.example` — **no `config`, no `Dockerfile`, no
wrapper entrypoint.** This is the most common path: bring a stock image, configure
by env, build nothing.

It exercises `image` (a stock upstream tag), `pull: "missing"` (pulled if absent —
the default, so omittable), a **port** and a **volume** (`3000:3000`, dashboards in a
named volume), and a `grafana.env.example` with one secret
(`GF_SECURITY_ADMIN_PASSWORD`, left empty for the operator) plus non-secret tunables
with defaults.

```bash
fh-workflow deploy <workflow.json> --component components/grafana
```

The wizard merges grafana beside the engine, prompts for the empty admin password (at
a terminal), and writes `grafana.env` (mode 0600) into the bundle. Then follow the
bundle's own README to build/transfer/run.

### `llama-server/` — the build-your-own-image case

The counterpart to grafana. `llama-server` fronts many local models on one endpoint
with [llama-swap](https://github.com/mostlygeek/llama-swap), and llama-swap reads a
**YAML** config while ForestHub hands a component its boot config as **JSON** at
`/etc/foresthub/config.json`. That mismatch is exactly the "speaks neither flags, env,
nor JSON" case above, so it ships a thin wrapper image.

`llama.cpp`'s `llama-server` hosts a **single model per process**; llama-swap wraps N
of them behind one OpenAI-compatible endpoint (`:8080`), starting and idle-evicting a
`llama-server` per model on demand. The engine picks a model by its `id` in the
request — one component, one port, many models, no per-model fan-out.

Two files carry it:

| File | Role |
| --- | --- |
| `Dockerfile` | `FROM` the stock llama-swap image (bundles both binaries) + `jq` + the entrypoint. No compile. |
| `entrypoint.sh` | The config bridge: `/etc/foresthub/config.json` (JSON) → llama-swap YAML → `exec llama-swap`. |

The bridge: the backend renders the model set to the component's `config.json` (a
models list); the operator stages the `.gguf` files under the component `Workspace`
(`/var/lib/foresthub/workspace`); [`entrypoint.sh`](./llama-server/entrypoint.sh) reads
that JSON with `jq`, emits a llama-swap YAML (one `cmd:` per model on llama-swap's
assigned `${PORT}`), validates each model file exists, then `exec`s llama-swap. A
malformed config or missing model file exits **78** — permanent, not retried; llama-swap
and each `llama-server` log to stdout.

The `config.json` shape the entrypoint reads:

```json
{
  "models": [
    { "id": "qwen", "file": "qwen2.5-3b-instruct-q4.gguf", "args": ["--ctx-size", "4096"] },
    { "id": "phi",  "file": "phi-3.5-mini-q4.gguf" }
  ]
}
```

- `id` — the model's address (the `model` field the engine sends); unique per component.
- `file` — a **bare** `.gguf` filename resolved under `Workspace` (avoid spaces).
- `args` — optional extra `llama-server` flags, appended verbatim.

Built by hand or CI, never by the wizard. From the folder:

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/foresthubai/llama-server:1.0.0 --push .
```

In CI this is
[`.github/workflows/release-llama-server.yml`](../.github/workflows/release-llama-server.yml)
(`workflow_dispatch`, semver input, refuses to clobber an existing tag). Treat semver
tags as immutable, and pin the moving base (`:cpu`, or `:cuda`/`:vulkan`) by digest in
the `Dockerfile` for reproducible rebuilds.

Unlike grafana, llama-server is a **first-party** component: the backend resolves it
and pins the published tag (like the engine image) rather than an operator handing it
to the wizard. The image-build mechanics generalize to any non-Go component regardless
of how it is deployed.

## Rules worth internalizing

- **`name` must be unique** across the deployment (engine, every llama-server component, and
  your other customs). It is the compose service name; a duplicate is a hard error.
  The same `image` under two different names is fine (e.g. two dashboards).
- **`pull` controls image fetching.** Omit it for a stock registry image — it
  defaults to `missing` (pulled if absent), correct for any Hub or registry tag.
  Set `"pull": "never"` only for an image you build locally that lives in no registry.
- **N instances = N folders**, each with a distinct `name`. There is no auto-fan-out
  for custom components.
- **Secrets only in `<name>.env`** — never in `component.json`, `config`, or the spec.
- **No start ordering.** Components are an unordered set; when one needs another it
  connects to a URL at runtime with retry, never a `depends_on` edge.
