// Generators — pure functions, each produces the text of one output file from
// the resolved DeploymentSpec (+ the device-env secrets that never enter the
// spec). composeYaml writes ${VAR:-} interpolations exclusively; operator values
// live in .env, never inlined here, so the same compose file works across every
// (.env, controller) pair.

import { createHash } from "node:crypto";
import { sidecarServiceName } from "./types";
import { ALL_PROVIDERS } from "./types";
import type { DeployConfig } from "./types";
import type { DeploymentSchemas } from "@foresthubai/workflow-core/api";

type DeploymentSpec = DeploymentSchemas["DeploymentSpec"];

// Container-internal paths. The engine reads ONE config file (workflow + bindings
// + manifest, unified) — Phase 1 collapsed the former four files into it.
const ENGINE_CONFIG_PATH = "/etc/foresthub/engine-config.json";
const MEMORY_PATH = "/var/lib/foresthub/memory";
const LLAMA_IMAGE_REPO = "ghcr.io/ggml-org/llama.cpp";

// Exported for testing purposes only.
export function composeYaml(spec: DeploymentSpec, cfg: DeployConfig): string {
  const engine = spec.components.engine;
  if (!engine) throw new Error("spec has no engine component"); // buildDeploymentSpec always sets it
  const llama = spec.components.llamaServer;
  const deviceGrants = engine.deviceGrants ?? [];
  const privileged = engine.privileged ?? false;

  // environment block. Operator values are ${VAR:-} interpolations (filled from
  // .env); container-internal paths are literal. Provider keys and the web-search
  // key are device env, not spec fields.
  const env: string[] = ["ENGINE_LOG_LEVEL: ${ENGINE_LOG_LEVEL:-info}"];
  for (const p of ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]))) {
    env.push(`${p.toUpperCase()}_API_KEY: \${${p.toUpperCase()}_API_KEY:-}`);
  }
  if (cfg.webSearch) {
    env.push("ENGINE_WEB_SEARCH_PROVIDER: ${ENGINE_WEB_SEARCH_PROVIDER:-brave}");
    env.push("ENGINE_WEB_SEARCH_API_KEY: ${ENGINE_WEB_SEARCH_API_KEY:-}");
  }
  env.push(`ENGINE_CONFIG_FILE: ${ENGINE_CONFIG_PATH}`);
  env.push(`ENGINE_MEMORY_DIR: ${MEMORY_PATH}`);

  // volume mounts — the single engine config file (read-only) + memory.
  const vols: string[] = [`./engine-config.json:${ENGINE_CONFIG_PATH}:ro`, `engine-memory:${MEMORY_PATH}`];

  // Content hash of the engine's boot config, stamped as a label so the engine's
  // compose config-hash changes when engine-config.json changes. Compose hashes
  // the service definition (labels included) but NOT the contents of bind-mounted
  // files, so without this a workflow/binding edit — same image, same env — would
  // leave `docker compose up -d` thinking the engine is up-to-date and never
  // recreate it. (llama needs no such label: its config is inline in `command`.)
  const configHash = createHash("sha256").update(JSON.stringify(engine.config)).digest("hex");
  const labelsBlock = `\n    labels:\n      com.foresthub.engine-config-hash: "${configHash}"`;

  const envBlock = env.map((l) => `      ${l}`).join("\n");
  const volBlock = vols.map((v) => `      - ${v}`).join("\n");

  // device passthrough — resolved into the spec: cdev nodes (GPIO, UART) map
  // one-to-one; sysfs families (ADC/DAC/PWM) have no single node, so privileged.
  const deviceBlock =
    deviceGrants.length > 0 ? `\n    devices:\n${deviceGrants.map((d) => `      - "${d}:${d}"`).join("\n")}` : "";
  const privilegedBlock = privileged
    ? "\n    # ADC/DAC/PWM need sysfs access (/sys/class/pwm, /sys/bus/iio). privileged is" +
      "\n    # the simple default — tighten to specific bind-mounts if your policy requires." +
      "\n    privileged: true"
    : "";

  // The image is distroless:nonroot, so the engine process cannot open the
  // root-owned device nodes / sysfs files mapped above. Run it as root whenever
  // any hardware is passed through.
  const needsRoot = deviceGrants.length > 0 || privileged;
  const userBlock = needsRoot
    ? "\n    # The engine image runs as nonroot and can't open root-owned device nodes /" +
      "\n    # sysfs files; root is the host-agnostic way to reach the mapped hardware below." +
      '\n    user: "0:0"'
    : "";

  // On-device models each get a llama-server sidecar the engine reaches by service
  // name over the compose network — no host networking.
  const deviceModels = (llama?.models ?? []).map((m) => ({
    service: sidecarServiceName(m.id),
    modelFile: m.modelFile ?? "",
    ctxVar: ctxSizeVar(m.id),
  }));
  const llamaImage = llama ? `${LLAMA_IMAGE_REPO}:${llama.version}` : "";
  const dependsBlock = deviceModels.length
    ? "\n    depends_on:\n" +
      deviceModels.map((d) => `      ${d.service}:\n        condition: service_healthy`).join("\n")
    : "";
  const sidecars = deviceModels
    .map(
      (d) => `  ${d.service}:
    image: ${llamaImage}
    pull_policy: missing
    restart: unless-stopped
    command:
      - --model
      - /models/${d.modelFile}
      - --host
      - "0.0.0.0"
      - --port
      - "8080"
      - --ctx-size
      - "\${${d.ctxVar}:-4096}"
    volumes:
      - ./models:/models:ro
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:8080/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 30
      start_period: 60s`,
    )
    .join("\n\n");
  const sidecarBlock = sidecars ? `\n\n${sidecars}` : "";

  return `# ForestHub engine — minimal standalone Compose deployment.
# See README.md for the build/transfer/run workflow.
# See .env for operator-set values.

services:
  engine:
    image: fh-engine:${engine.version}
    pull_policy: never
    restart: unless-stopped${labelsBlock}${userBlock}${dependsBlock}
    environment:
${envBlock}
    volumes:
${volBlock}${deviceBlock}${privilegedBlock}${sidecarBlock}

volumes:
  engine-memory:
`;
}

// Exported for testing purposes only.
export function envFile(cfg: DeployConfig): string {
  const localProviders = ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]));
  const providerSection =
    localProviders.length === 0
      ? ""
      : `# ----- LLM provider keys -----
# Each key here = that provider runs locally with your API key.
${localProviders.map((p) => `${p.toUpperCase()}_API_KEY=${cfg.llmKeys[p] ?? ""}`).join("\n")}

`;

  // Only present when the workflow has a WebSearchTool node (cfg.webSearch set).
  const webSearchSection = cfg.webSearch
    ? `# ----- Web search -----
ENGINE_WEB_SEARCH_PROVIDER=${cfg.webSearch.provider}
ENGINE_WEB_SEARCH_API_KEY=${cfg.webSearch.apiKey}

`
    : "";

  // One context-size var per on-device model (llama-server sidecar), so each is
  // tunable on its own.
  const deviceModelIds = Object.entries(cfg.models)
    .filter(([, b]) => b.location === "device")
    .map(([id]) => id);
  const onDeviceSection = deviceModelIds.length
    ? `# ----- On-device models -----
# Context window per llama-server sidecar.
${deviceModelIds.map((id) => `${ctxSizeVar(id)}=4096`).join("\n")}

`
    : "";

  return `# ForestHub engine — operator configuration.
# Auto-generated by \`fh-workflow deploy\`. \`docker compose\` auto-loads this file.
# Secret values: chmod 600 .env after editing.

${providerSection}${webSearchSection}${onDeviceSection}# ----- Runtime -----
ENGINE_LOG_LEVEL=${cfg.logLevel}     # debug | info | warn | error
`;
}

// Exported for testing purposes only.
export function readme(spec: DeploymentSpec, cfg: DeployConfig, hasProviderModel: boolean): string {
  const localProviders = ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]));
  const providerBlock =
    localProviders.length === 0
      ? "_No local API keys set._ An Agent that uses a catalog model will fail at build — set the matching key in `.env`."
      : localProviders.map((p) => `- **${p}** — runs locally (your API key)`).join("\n");

  const engine = spec.components.engine;
  const hasHardware = (engine?.deviceGrants?.length ?? 0) > 0 || Boolean(engine?.privileged);
  const deviceModelFiles = (spec.components.llamaServer?.models ?? []).map((m) => m.modelFile ?? "");
  const hasNetworkModel = Object.values(cfg.models).some((b) => b.location === "network");
  const hasMqtt = Object.keys(cfg.mqtt).length > 0;
  const hasExternalService = hasMqtt || hasNetworkModel;

  // Per-workflow operator notes — only the relevant ones, in this order:
  // provider keys, hardware, external services, on-device models, network models,
  // web search.
  const notes: string[] = [];

  if (hasProviderModel || localProviders.length > 0) {
    notes.push(`## LLM provider keys

${providerBlock}

The engine calls each provider directly with the API key from \`.env\`. Without a
key, an Agent node that uses that provider's catalog model fails at build.`);
  }
  if (hasHardware) {
    notes.push(`## Hardware access

This bundle maps your devices into the container and runs it as \`user: "0:0"\` (the
image is nonroot and cannot open root-owned device nodes). GPIO/UART are passed via
\`devices:\`; ADC/DAC/PWM need sysfs and run the container \`privileged\` — review this
and tighten it to your security policy before deploying.`);
  }
  if (hasExternalService) {
    notes.push(`## External resources

\`engine-config.json\` holds the broker/endpoint credentials the engine connects with —
keep it \`chmod 600\`. This bundle does not start those services; it assumes the
broker/endpoint already exists and is reachable from the controller.`);
  }
  if (deviceModelFiles.length > 0) {
    notes.push(`## On-device models

This bundle runs a llama-server container per on-device model; the engine reaches it
over the compose network by service name. The GGUF file(s) below must sit in a
\`models/\` folder next to the compose file on the controller. They are too large for
the main \`scp\` line, so step 3 transfers them separately:
${deviceModelFiles.map((f) => `- \`./models/${f}\``).join("\n")}`);
  }
  if (hasNetworkModel) {
    notes.push(`## Network models

A network model points at an inference endpoint **you run yourself** (llama-server, vLLM,
Ollama, ...) on another machine. This bundle does not start that server for you.`);
  }
  if (cfg.webSearch) {
    notes.push(`## Web search

The web-search API key is in \`.env\` (\`ENGINE_WEB_SEARCH_API_KEY\`).`);
  }
  const notesBlock = notes.length ? "\n" + notes.join("\n\n") + "\n" : "";

  // On-device model weights ship outside the main scp line (GGUF can be several GB).
  const modelsTransfer = deviceModelFiles.length
    ? `

# On-device model weights — too large for the line above (GGUF can be several GB).
# Copy them from this bundle:
scp -r models/ $CONTROLLER_USER@$CONTROLLER_ADDR:~/fh-engine/
# ...or download them directly into ~/fh-engine/models/ on the controller.`
    : "";

  // With an on-device sidecar the engine waits on its health before starting, so
  // show every container; otherwise the engine log alone is enough.
  const runBlock = deviceModelFiles.length
    ? `ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker load -i fh-engine.tar'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose up -d'

# The engine only starts once the llama-server sidecar reports healthy. If the engine
# stays "created", inspect the sidecar — these show every container, not just the engine:
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose ps'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose logs -f'`
    : `ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker load -i fh-engine.tar'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose up -d'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose logs -f engine'`;

  return `# ForestHub engine — deployment bundle

Generated by \`fh-workflow deploy\`. This directory contains everything needed to
run one engine instance on an edge controller, **standalone** — the engine boots
the workflow from \`engine-config.json\` and runs it autonomously:

- \`docker-compose.yml\` — deployment template
- \`engine-config.json\` — the engine's single boot config (workflow + bindings + device manifest; **secrets — \`chmod 600\`**)
- \`deployment-spec.json\` — the full resolved deployment spec (record + re-apply source)
- \`.env\` — operator configuration (already filled in, \`chmod 600\` it)
- \`fh-engine.tar\` — image tarball (you build this in step 1 below)
${notesBlock}
## 1. Build the image (on the dev machine)

From a clone of the edge-agents repo:

\`\`\`bash
cd go
# Native build (matches the dev machine's arch)
docker build -t fh-engine:latest .

# Cross-build for ARM controller from x86 dev box (or vice-versa)
docker buildx build --platform linux/arm64 -t fh-engine:latest --load .
docker buildx build --platform linux/amd64 -t fh-engine:latest --load .
\`\`\`

## 2. Review the generated \`.env\`

\`\`\`bash
chmod 600 .env engine-config.json deployment-spec.json
\`\`\`

The wizard already filled in your operator values. Double-check before
transferring — secrets are in plaintext.

## 3. Save the image and transfer to the controller

\`\`\`bash
export CONTROLLER_USER=<your-user>
export CONTROLLER_ADDR=<controller-ip-or-hostname>

cd go
docker save fh-engine:latest -o ../path/to/this/bundle/fh-engine.tar

ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'mkdir -p ~/fh-engine'

cd path/to/this/bundle
scp fh-engine.tar docker-compose.yml engine-config.json deployment-spec.json .env \\
    $CONTROLLER_USER@$CONTROLLER_ADDR:~/fh-engine/${modelsTransfer}
\`\`\`

## 4. Run (on the controller)

\`\`\`bash
${runBlock}
\`\`\`

## Agent memory

The workflow's memory files live in the named volume \`engine-memory\` (mounted at
\`/var/lib/foresthub/memory\`). They survive restarts and \`docker compose down\`;
only \`docker compose down -v\` deletes them. The volume is namespaced by the
compose project name, which defaults to the bundle directory's name — keep it
stable across updates, or pin it via \`COMPOSE_PROJECT_NAME\`. In this standalone
bundle the volume is the only copy of the memory.
`;
}

// Exported for testing purposes only.
// Per-sidecar env var for a model's llama-server context size, derived from the
// model id so each on-device model is tunable on its own.
export function ctxSizeVar(modelId: string): string {
  const suffix = modelId
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `LLAMA_CTX_SIZE_${suffix || "MODEL"}`;
}

// Exported for testing purposes only.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
