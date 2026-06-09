# The bundle and what the operator does with it

`fh-workflow deploy` writes a **self-contained, standalone** deployment bundle: a directory the
engine boots from `workflow.json` and runs autonomously, with no control plane. This reference
describes what lands in that directory and the operator's path from there, so the skill can report
accurately and point to the generated `README.md` for the authoritative copy.

## Files in the bundle

Always written:

| File                 | Purpose                                         | Mode |
| -------------------- | ----------------------------------------------- | ---- |
| `workflow.json`      | the graph the engine executes                   | 644 |
| `docker-compose.yml` | the deployment template (engine + any sidecars) | 644 |
| `.env`               | operator config — keys, log level, ctx sizes    | **600 (secret)** |
| `README.md`          | the operator's build/transfer/run guide         | 644 |

Written only when the workflow needs them:

| File                       | When                                   | Mode |
| -------------------------- | -------------------------------------- | ---- |
| `device_manifest.json`     | any hardware channel                    | 644 |
| `external_resources.json`  | any MQTT channel or custom model        | **600 (secret)** |
| `deployment_mapping.json`  | any hardware channel, MQTT, or model    | 644 |
| `models/` (directory)      | any **device** model                    | dir — operator drops the `.gguf` here |

The two `600` files (`.env`, `external_resources.json`) carry the secrets — provider keys, MQTT
passwords, model API keys. **Never `cat` them.** They hold the sentinel placeholders the operator
must replace.

## On-device models — the llama-server sidecar

A custom model with `location: "device"` makes the bundle self-host it: the compose file gains a
`llama-<slug>` service (image `ghcr.io/ggml-org/llama.cpp:server-b8589`) that mounts `./models:/models:ro`,
serves on port 8080, and has a healthcheck; the engine `depends_on` it (`condition: service_healthy`)
and reaches it at `http://llama-<slug>:8080`. The context window is `LLAMA_CTX_SIZE_<ID>` in `.env`
(default 4096). The `.gguf` weights are **not** in the bundle — the operator copies them into
`models/` separately (the README has the `scp` line).

A `location: "network"` model is the opposite: it points at an endpoint the operator **already runs**
elsewhere; the bundle starts nothing for it and just records the URL (+ optional key).

There is deliberately **no `network_mode: host`** and **no fixed `container_name`** — services talk
over the compose bridge network by service name, and several bundles can coexist on one host.

## The operator's next steps (authoritative copy is the generated README)

The skill stops after writing the bundle; these steps stay manual. Summarize them and point to
`README.md` rather than running them:

1. **Build the engine image** — from the `edge-agents` checkout: `docker build -t fh-engine:latest go/`
   (or a `buildx --platform linux/arm64` cross-build for an ARM controller). The image isn't pulled;
   the operator builds and `docker save`s it.
2. **Fill the secrets** — replace every `REPLACE_ME_*` placeholder in `.env` (and
   `external_resources.json` if present); keep both `chmod 600`.
3. **Transfer** — `docker save fh-engine:latest -o fh-engine.tar`, then `scp` the tar + the bundle
   files to the controller. Device-model `.gguf`s go separately (`scp -r models/`) — they're large.
4. **Run** — on the controller: `docker load -i fh-engine.tar`, then `docker compose up -d`. With a
   sidecar the engine only starts once the sidecar is healthy; `docker compose ps` / `logs` (no
   service filter) show every container, not just the engine.

The generated `README.md` carries all of this with the exact, workflow-specific commands and any
conditional notes (hardware passthrough, external-resource credentials, web-search key). Always
defer to it.
