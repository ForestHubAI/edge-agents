# Custom components

`fh-workflow deploy` runs the engine (and a llama-server per on-device model) for
you. A **custom component** is any extra container you co-deploy alongside them —
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

See [`grafana/`](./grafana) for a complete worked example.

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

A bundled MQTT broker (mosquitto) is a typical custom component: stock image, a
published port, a config file or env for its listener/auth — co-deployed so a
workflow's MQTT channels have a broker to reach.

## Rules worth internalizing

- **`name` must be unique** across the deployment (engine, every llama sidecar, and
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
