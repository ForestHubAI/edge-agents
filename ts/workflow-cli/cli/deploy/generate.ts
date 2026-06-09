// Generators — pure functions, each produces the text of one output file.
//
// composeYaml writes ${VAR:-} interpolations exclusively. Operator values live
// in .env, never inlined here, so the same compose file works across every
// (.env, controller) pair.

import { sidecarServiceName } from "./builders";
import { ALL_PROVIDERS } from "./types";
import type { DeployConfig, DeployRequirements } from "./types";

// Exported for testing purposes only.
export function composeYaml(cfg: DeployConfig, req: DeployRequirements): string {
  const hasHardware = req.hardwareChannels.length > 0;
  const hasExternal = req.mqttChannels.length > 0 || req.customModels.length > 0;
  const hasMapping = hasHardware || hasExternal;

  // environment block. Operator values are ${VAR:-} interpolations (filled from
  // .env); container-internal paths are literal. A *_FILE var is set only when
  // that file is emitted — the engine skips an unset one.
  const env: string[] = ["ENGINE_LOG_LEVEL: ${ENGINE_LOG_LEVEL:-info}"];
  for (const p of ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]))) {
    env.push(`${p.toUpperCase()}_API_KEY: \${${p.toUpperCase()}_API_KEY:-}`);
  }
  if (req.hasWebSearch) {
    env.push("ENGINE_WEB_SEARCH_PROVIDER: ${ENGINE_WEB_SEARCH_PROVIDER:-brave}");
    env.push("ENGINE_WEB_SEARCH_API_KEY: ${ENGINE_WEB_SEARCH_API_KEY:-}");
  }
  env.push("ENGINE_CONFIG_FILE: /etc/foresthub/workflow.json");
  env.push("ENGINE_MEMORY_DIR: /var/forest/memory");
  if (hasHardware) env.push("ENGINE_DEVICE_MANIFEST_FILE: /etc/foresthub/device_manifest.json");
  if (hasExternal) env.push("ENGINE_EXTERNAL_RESOURCES_FILE: /etc/foresthub/external_resources.json");
  if (hasMapping) env.push("ENGINE_DEPLOYMENT_MAPPING_FILE: /etc/foresthub/deployment_mapping.json");

  // volume mounts — workflow + the emitted deploy files (read-only) + memory.
  const vols: string[] = ["./workflow.json:/etc/foresthub/workflow.json:ro"];
  if (hasHardware) vols.push("./device_manifest.json:/etc/foresthub/device_manifest.json:ro");
  if (hasExternal) vols.push("./external_resources.json:/etc/foresthub/external_resources.json:ro");
  if (hasMapping) vols.push("./deployment_mapping.json:/etc/foresthub/deployment_mapping.json:ro");
  vols.push("engine-memory:/var/forest/memory");

  // device passthrough. cdev nodes (GPIO, UART) map one-to-one; sysfs families
  // (ADC/DAC/PWM) have no single node, so the container runs privileged.
  const cdev = new Set<string>();
  let needsPrivileged = false;
  for (const ch of req.hardwareChannels) {
    const dev = cfg.hardware[ch.id]?.chipOrDevice;
    if (!dev) continue;
    if (ch.family === "gpio" || ch.family === "serial") cdev.add(dev);
    else needsPrivileged = true;
  }

  const envBlock = env.map((l) => `      ${l}`).join("\n");
  const volBlock = vols.map((v) => `      - ${v}`).join("\n");
  const deviceBlock =
    cdev.size > 0 ? `\n    devices:\n${[...cdev].map((d) => `      - "${d}:${d}"`).join("\n")}` : "";
  const privilegedBlock = needsPrivileged
    ? "\n    # ADC/DAC/PWM need sysfs access (/sys/class/pwm, /sys/bus/iio). privileged is" +
      "\n    # the simple default — tighten to specific bind-mounts if your policy requires." +
      "\n    privileged: true"
    : "";

  // The image is distroless:nonroot, so the engine process cannot open the
  // root-owned device nodes / sysfs files mapped above. Run it as root whenever
  // any hardware is passed through — orthogonal to devices:/privileged: (which
  // grant access at the container level; this grants permission at the process).
  const needsRoot = cdev.size > 0 || needsPrivileged;
  const userBlock = needsRoot
    ? "\n    # The engine image runs as nonroot and can't open root-owned device nodes /" +
      "\n    # sysfs files; root is the host-agnostic way to reach the mapped hardware below." +
      '\n    user: "0:0"'
    : "";

  // On-device models each get a llama-server sidecar the engine reaches by service
  // name over the compose network — no host networking. network models add nothing.
  const deviceModels: { service: string; modelFile: string }[] = [];
  for (const m of req.customModels) {
    const b = cfg.models[m.id];
    if (b?.location === "device") deviceModels.push({ service: sidecarServiceName(m.id), modelFile: b.modelFile });
  }
  const dependsBlock = deviceModels.length
    ? "\n    depends_on:\n" +
      deviceModels.map((d) => `      ${d.service}:\n        condition: service_healthy`).join("\n")
    : "";
  const sidecars = deviceModels
    .map(
      (d) => `  ${d.service}:
    image: ghcr.io/ggml-org/llama.cpp:server-b8589
    pull_policy: missing
    container_name: fh-${d.service}
    restart: unless-stopped
    command:
      - --model
      - /models/${d.modelFile}
      - --host
      - "0.0.0.0"
      - --port
      - "8080"
      - --ctx-size
      - "\${LLAMA_CTX_SIZE:-4096}"
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
    image: fh-engine:latest
    pull_policy: never
    container_name: fh-engine
    restart: unless-stopped${userBlock}${dependsBlock}
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

  // Only present when at least one model runs on-device (a llama-server sidecar).
  const onDeviceSection = Object.values(cfg.models).some((b) => b.location === "device")
    ? `# ----- On-device models -----
LLAMA_CTX_SIZE=4096     # context window for every llama-server sidecar

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
export function readme(cfg: DeployConfig, req: DeployRequirements): string {
  const localProviders = ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]));
  const providerBlock =
    localProviders.length === 0
      ? "_No local API keys set._ An Agent that uses a catalog model will fail at build — set the matching key in `.env`."
      : localProviders.map((p) => `- **${p}** — runs locally (your API key)`).join("\n");

  const hasHardware = req.hardwareChannels.length > 0;
  const hasExternal = req.mqttChannels.length > 0 || req.customModels.length > 0;

  // Split custom models into their two runtime kinds up front: both the notes and
  // the external-resources gating key off this. A device model is a sidecar this
  // bundle runs; a network model is an endpoint the operator runs elsewhere.
  const deviceModelFiles: string[] = [];
  let hasNetworkModel = false;
  for (const m of req.customModels) {
    const b = cfg.models[m.id];
    if (b?.location === "device") deviceModelFiles.push(b.modelFile);
    else if (b?.location === "network") hasNetworkModel = true;
  }

  // An MQTT broker or a network model is a service that lives outside this bundle —
  // external_resources.json then carries the credentials the engine connects with. A
  // device-only bundle's entry is just the sidecar's in-network URL (no secret).
  const hasExternalService = req.mqttChannels.length > 0 || hasNetworkModel;

  // Deploy wire-files actually present in this bundle (mirrors write.ts).
  const deployFiles: string[] = [];
  if (hasHardware) deployFiles.push("- `device_manifest.json` — hardware the engine binds at boot");
  if (hasExternal)
    deployFiles.push("- `external_resources.json` — MQTT brokers / model endpoints (**secrets — `chmod 600`**)");
  if (hasHardware || hasExternal)
    deployFiles.push("- `deployment_mapping.json` — maps the workflow's resources to the entries above");
  const deployFilesBlock = deployFiles.length ? "\n" + deployFiles.join("\n") : "";

  // Per-workflow operator notes — only the relevant ones appear, in this order:
  // provider keys, hardware, external services, on-device models, network models,
  // web search.
  const notes: string[] = [];

  // Catalog (provider) models need an API key from .env; on-device and network
  // custom models do not. Surface the key section only when a catalog model is
  // actually used, or the operator pre-set a key — a purely local bundle needs none.
  if (req.hasProviderModel || localProviders.length > 0) {
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

\`external_resources.json\` holds the broker/endpoint credentials the engine connects
with — keep it \`chmod 600\`. This bundle does not start those services; it assumes the
broker/endpoint already exists and is reachable from the controller.`);
  }
  if (deviceModelFiles.length > 0) {
    notes.push(`## On-device models

This bundle runs a llama-server container per on-device model; the engine reaches it
over the compose network by service name. Place the model file(s) in \`./models/\`
before deploying and copy that folder to the controller too (GGUF files can be several
GB, so they are not in the \`scp\` line below):
${deviceModelFiles.map((f) => `- \`./models/${f}\``).join("\n")}`);
  }
  if (hasNetworkModel) {
    notes.push(`## Network models

A network model points at an inference endpoint **you run yourself** (llama-server, vLLM,
Ollama, ...) on another machine. This bundle does not start that server for you.`);
  }
  if (req.hasWebSearch) {
    notes.push(`## Web search

The web-search API key is in \`.env\` (\`ENGINE_WEB_SEARCH_API_KEY\`).`);
  }
  const notesBlock = notes.length ? "\n" + notes.join("\n\n") + "\n" : "";

  // Extra files to scp alongside the base set — must match what was emitted, or
  // the engine boots against a mounted file that isn't there.
  const transferExtra = [
    hasHardware ? "device_manifest.json" : "",
    hasExternal ? "external_resources.json" : "",
    hasHardware || hasExternal ? "deployment_mapping.json" : "",
  ].filter(Boolean);
  const transferExtraStr = transferExtra.length ? " " + transferExtra.join(" ") : "";

  return `# ForestHub engine — deployment bundle

Generated by \`fh-workflow deploy\`. This directory contains everything needed to
run one engine instance on an edge controller, **standalone** — the engine boots
the workflow from \`workflow.json\` and runs it autonomously:

- \`docker-compose.yml\` — deployment template
- \`workflow.json\` — the workflow graph the engine executes${deployFilesBlock}
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
chmod 600 .env
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
scp fh-engine.tar docker-compose.yml workflow.json${transferExtraStr} .env \\
    $CONTROLLER_USER@$CONTROLLER_ADDR:~/fh-engine/
\`\`\`

## 4. Run (on the controller)

\`\`\`bash
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker load -i fh-engine.tar'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose up -d'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose logs -f engine'
\`\`\`
`;
}

// Exported for testing purposes only.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
