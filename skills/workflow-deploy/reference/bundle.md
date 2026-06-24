# The bundle and what the operator does with it

`fh-workflow deploy` writes a **self-contained, standalone** deployment bundle: a directory the
engine boots from `engine-config.json` and runs autonomously, with no control plane. This reference
describes what lands in that directory and the operator's path from there, so the skill can report
accurately and point to the generated `README.md` for the authoritative copy.

## Files in the bundle

Always written:

| File                   | Purpose                                                                | Mode |
| ---------------------- | --------------------------------------------------------------------- | ---- |
| `engine-config.json`   | the engine's single boot config — workflow + device manifest + resource mapping + external resources, all in one blob | 644 |
| `docker-compose.yml`   | the deployment template (engine + any sidecars + custom components)   | 644 |
| `engine.env`           | operator config — provider keys, web-search key, MQTT/model secrets (in `FH_RESOURCE_SECRETS`), log level | **600 (secret)** |
| `deployment-spec.json` | the full resolved deployment record (secret-free)                     | 644 |
| `README.md`            | the operator's build/transfer/run guide                               | 644 |

Written only when the workflow / setup needs them:

| File                  | When                                                | Mode |
| --------------------- | --------------------------------------------------- | ---- |
| `models/` (directory) | any **device** model                                | dir — operator drops the `.gguf` here |
| `<name>-config.json`  | a custom component whose `component.json` carries a `config` blob | 644 |
| `<name>.env`          | a custom component that ships a `<name>.env.example`| **600 (secret-bearing)** |

The two component files are **outputs**, not the operator's input: a component's own `component.json`
(the file in the `--component` folder) is read at deploy time and **never** copied into the bundle —
only the `config` blob it may declare is written out, as `<name>-config.json`. See _Custom
components_ below.

There are **no** separate `workflow.json`, `device_manifest.json`, `deployment_mapping.json`, or
`external_resources.json` files — those sections are consolidated inside `engine-config.json`. All
secrets live in `engine.env` (the engine's own keys, plus the `FH_RESOURCE_SECRETS` blob holding MQTT
passwords / network-model keys) and in any custom component's `<name>.env`. **Never `cat` the `600`
files** — inspect them by `ls -l` only. They hold the sentinel placeholders the operator must replace.

## On-device models — the llama-server sidecar

A custom model with `location: "device"` makes the bundle self-host it: the compose file gains a
`llama-<slug>` service (image `ghcr.io/ggml-org/llama.cpp:server-b8589`) that mounts `./models:/models:ro`
and serves on port 8080; the engine reaches it at `http://llama-<slug>:8080`. There is deliberately
**no `depends_on` and no healthcheck** — the engine connects at runtime and retries until the sidecar
is up, so there is no start-ordering between them. The context window is frozen into the sidecar's
compose `command` (`--ctx-size`, default 4096) at deploy time — retuning it is a re-deploy, not an env
edit. The `.gguf` weights are **not** in the bundle — the operator copies them into `models/`
separately (the README has the `scp` line).

A `location: "network"` model is the opposite: it points at an endpoint the operator **already runs**
elsewhere; the bundle starts nothing for it and just records the URL (+ optional key).

There is deliberately **no `network_mode: host`** and **no fixed `container_name`** — services talk
over the compose bridge network by service name, and several bundles can coexist on one host.

## Custom components — operator-authored extra containers

Beyond the engine and any model sidecars, the operator can co-deploy **custom components**: extra
containers (a dashboard, a local broker, a metrics agent) they author and pass with a repeatable
`--component <folder>` flag. Each folder holds a `component.json` declaring the container (name,
image, `pull` policy, ports, volumes, an optional `config` blob) and may ship a `<name>.env.example`.

At deploy time each `component.json` is validated against the deploy contract (a wrong shape or a
duplicate name fails the deploy with a precise message), then merged into the same
`docker-compose.yml` beside the engine — it renders exactly like a first-party service. Custom
components are **never matched against the workflow graph**; they just ride along. A folder's
`<name>.env.example` becomes a `chmod 600` `<name>.env` in the bundle (filled values taken, empty ones
left blank for the operator). The component's image pull behaviour comes from its `pull` field
(`always` | `missing` | `never`; default `missing`), not from any guess about the image name.

## The operator's next steps (authoritative copy is the generated README)

The skill stops after writing the bundle; these steps stay manual. Summarize them and point to
`README.md` rather than running them:

1. **Build the engine image** — from the `edge-agents` checkout: `docker build -t fh-engine:latest go/`
   (or a `buildx --platform linux/arm64` cross-build for an ARM controller). The image isn't pulled;
   the operator builds and `docker save`s it.
2. **Fill the secrets** — replace every `REPLACE_ME_*` placeholder in `engine.env` (and any empty
   values in a custom component's `<name>.env`); keep the `chmod 600` files locked down.
3. **Transfer** — `docker save fh-engine:latest -o fh-engine.tar`, then `scp` the tar + the bundle
   files to the controller. Device-model `.gguf`s go separately (`scp -r models/`) — they're large.
4. **Run** — on the controller: `docker load -i fh-engine.tar`, then `docker compose up -d`. The
   engine and any sidecar start independently — the engine retries until the sidecar is up — so
   `docker compose ps` / `logs` (no service filter) show every container while things settle, not just
   the engine.

The generated `README.md` carries all of this with the exact, workflow-specific commands and any
conditional notes (hardware passthrough, external-resource credentials, web-search key). Always
defer to it.
