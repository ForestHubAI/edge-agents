// Generators — pure functions, each produces the text of one output file from
// the resolved DeploymentSpec (+ the device-env secrets that never enter the
// spec). composeYaml writes ${VAR:-} interpolations exclusively; operator values
// live in .env, never inlined here, so the same compose file works across every
// (.env, controller) pair.

import { createHash } from "node:crypto";
import { ALL_PROVIDERS } from "./types";
import type { DeployConfig } from "./types";
import type { DeploymentSchemas } from "@foresthubai/workflow-core/api";
import { llmSidecarServiceName, mlSidecarServiceName, cameraSidecarServiceName } from "@foresthubai/workflow-core/deploy";
import type { ResourceSecrets } from "@foresthubai/workflow-core/deploy";

type DeploymentSpec = DeploymentSchemas["DeploymentSpec"];
type DeployComponent = DeploymentSchemas["DeployComponent"];

// Convention mount path for a component's config file when it sets no configPath —
// matches the path first-party images (the engine) default to reading.
const DEFAULT_CONFIG_PATH = "/etc/foresthub/config.json";

// The config-file basename a component's config blob is written to (write.ts) and
// bind-mounted from. One source of truth so the renderer and writer agree.
export function configFileName(name: string): string {
  return `${name}-config.json`;
}

// A volume mount's source is a named volume (vs a host bind mount) when it is not
// a path — bind mounts start with "." or "/". Named sources need a top-level
// `volumes:` declaration; bind mounts do not.
function namedVolumeSource(mount: string): string | null {
  const src = mount.split(":")[0] ?? "";
  return src && !src.startsWith(".") && !src.startsWith("/") ? src : null;
}

// Render one DeployComponent to a compose service block, by a single uniform field
// mapping — NO branching on which component it is, so a custom component renders
// exactly like a first-party one. Component-specific knowledge lives in the
// resolver (which produced this) and in the image's own entrypoint, never here.
function serviceBlock(c: DeployComponent): string {
  // pull_policy comes straight from the component; "missing" (Docker's default)
  // pulls a registry image if absent, the right default for any stock image.
  const lines: string[] = [`  ${c.name}:`, `    image: ${c.image}`, `    pull_policy: ${c.pull ?? "missing"}`, "    restart: unless-stopped"];

  // Content hash of the config blob, stamped as a label so the service's compose
  // config-hash changes when the bind-mounted config file changes. Compose hashes
  // the service definition (labels included) but NOT the contents of bind-mounted
  // files, so without this a config edit — same image, same env — would leave
  // `docker compose up -d` thinking the container is up-to-date and never recreate
  // it. Omitted for a component with no config (e.g. llama: config rides in command).
  if (c.config !== undefined) {
    const hash = createHash("sha256").update(JSON.stringify(c.config)).digest("hex");
    lines.push("    labels:", `      com.foresthub.config-hash: "${hash}"`);
  }

  // Run as root only when the resolver asked for it (a nonroot image reaching
  // root-owned device nodes / sysfs files passed through below).
  if (c.user) lines.push(`    user: "${c.user}"`);

  // Exec-form command override, frozen in the spec (e.g. llama's CLI flags).
  if (c.command && c.command.length > 0) {
    lines.push("    command:");
    for (const arg of c.command) lines.push(`      - "${arg}"`);
  }

  // Operator secrets/values are device-local, never in the spec — they arrive
  // through a "<name>.env" file the operator supplies (the CLI pre-fills one for
  // components that need it). required:false so a component with no env file (most
  // sidecars) does not break `up`.
  lines.push("    env_file:", `      - path: ${c.name}.env`, "        required: false");

  // Config blob: bind-mount the file write.ts wrote at the component's configPath
  // (read-only), plus the component's own volume mounts.
  const volumes = [...(c.config !== undefined ? [`./${configFileName(c.name)}:${c.configPath ?? DEFAULT_CONFIG_PATH}:ro`] : []), ...(c.volumes ?? [])];
  if (volumes.length > 0) {
    lines.push("    volumes:");
    for (const v of volumes) lines.push(`      - ${v}`);
  }

  // cdev nodes (GPIO, UART) pass through one-to-one; sysfs families (ADC/DAC/PWM)
  // have no single node, so the resolver set privileged instead.
  if (c.devices && c.devices.length > 0) {
    lines.push("    devices:");
    for (const d of c.devices) lines.push(`      - "${d}:${d}"`);
  }
  if (c.ports && c.ports.length > 0) {
    lines.push("    ports:");
    for (const p of c.ports) lines.push(`      - "${p}"`);
  }
  if (c.privileged) {
    lines.push(
      "    # ADC/DAC/PWM need sysfs access (/sys/class/pwm, /sys/bus/iio). privileged is",
      "    # the simple default — tighten to specific bind-mounts if your policy requires.",
      "    privileged: true",
    );
  }

  return lines.join("\n");
}

// Exported for testing purposes only. A total function of the spec — operator
// values live in the .env files the renderer references, never in the compose shape.
export function composeYaml(spec: DeploymentSpec): string {
  const services = spec.components.map(serviceBlock).join("\n\n");

  // Top-level named volumes, deduped across every component's mounts.
  const named = [...new Set(spec.components.flatMap((c) => (c.volumes ?? []).map(namedVolumeSource).filter((s): s is string => s !== null)))];
  const volumesBlock = named.length > 0 ? `\nvolumes:\n${named.map((n) => `  ${n}:`).join("\n")}\n` : "";

  return `# Edge Agents engine — minimal standalone Compose deployment.
# See README.md for the build/transfer/run workflow.
# See the <component>.env files for operator-set values.

services:
${services}
${volumesBlock}`;
}

// Exported for testing purposes only.
export function envFile(cfg: DeployConfig, resourceSecrets: ResourceSecrets = {}): string {
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

  // Broker passwords / endpoint keys as one JSON blob, keyed by resolved resource
  // id. Injected into the engine at runtime; never written to the spec. JSON
  // starts with `{`, so docker compose .env reads it verbatim (no quote stripping).
  const resourceSecretsSection =
    Object.keys(resourceSecrets).length > 0
      ? `# ----- External-resource secrets -----
FH_RESOURCE_SECRETS=${JSON.stringify(resourceSecrets)}

`
      : "";

  return `# Edge Agents engine — operator configuration.
# Auto-generated by \`fh-workflow deploy\`. Loaded into the engine via the compose
# \`env_file\`. Secret values: chmod 600 this file after editing.

${providerSection}${webSearchSection}${resourceSecretsSection}# ----- Runtime -----
ENGINE_LOG_LEVEL=${cfg.logLevel}     # debug | info | warn | error
`;
}

// The capture sidecar's cameras.json content: one entry per on-device camera,
// keyed by the channel id the engine requests it by. Null when no camera is
// on-device (a network camera needs no local config) — then no file is written.
export function camerasJson(cfg: DeployConfig): string | null {
  const cameras: Record<string, { source: "v4l2" | "gstreamer"; device: string; warmupFrames?: number }> = {};
  for (const [id, b] of Object.entries(cfg.cameras)) {
    if (b.location === "device") {
      const entry: { source: "v4l2" | "gstreamer"; device: string; warmupFrames?: number } = { source: b.source, device: b.device };
      if (b.warmupFrames && b.warmupFrames > 0) entry.warmupFrames = b.warmupFrames;
      cameras[id] = entry;
    }
  }
  if (Object.keys(cameras).length === 0) return null;
  return JSON.stringify({ cameras }, null, 2) + "\n";
}

// Exported for testing purposes only.
export function readme(spec: DeploymentSpec, cfg: DeployConfig, hasProviderModel: boolean): string {
  const localProviders = ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]));
  const providerBlock =
    localProviders.length === 0
      ? "_No local API keys set._ An Agent that uses a catalog model will fail at build — set the matching key in `engine.env`."
      : localProviders.map((p) => `- **${p}** — runs locally (your API key)`).join("\n");

  const engine = spec.components.find((c) => c.name === "engine");
  const hasHardware = (engine?.devices?.length ?? 0) > 0 || Boolean(engine?.privileged);
  // Each on-device model's GGUF lives in its sidecar's own workspace dir
  // (./workspaces/<service>/) — the host bind mount the llama container reads.
  const deviceModels = Object.entries(cfg.llmModels).flatMap(([id, b]) =>
    b.location === "device" ? [{ dir: `./workspaces/${llmSidecarServiceName(id)}`, file: b.modelFile }] : [],
  );
  const hasNetworkModel = Object.values(cfg.llmModels).some((b) => b.location === "network");
  // On-device ML models all share ONE inference sidecar; each model's bundle
  // lives in its own sub-folder of that sidecar's repository dir.
  const mlRepoDir = `./workspaces/${mlSidecarServiceName()}`;
  const mlDeviceModels = Object.entries(cfg.mlModels).flatMap(([id, b]) => (b.location === "device" ? [id] : []));
  const hasNetworkMLModel = Object.values(cfg.mlModels).some((b) => b.location === "network");
  const hasMqtt = Object.keys(cfg.mqtt).length > 0;
  const hasExternalService = hasMqtt || hasNetworkModel;
  // On-device cameras share ONE capture sidecar; its cameras.json lives under that
  // sidecar's workspace dir. v4l2 cameras get a /dev passthrough; gstreamer/CSI
  // cameras need the operator to wire the full media graph (see the note below).
  const cameraDir = `./workspaces/${cameraSidecarServiceName()}`;
  const deviceCameras = Object.values(cfg.cameras).filter((b) => b.location === "device");
  const hasV4l2Camera = deviceCameras.some((b) => b.source === "v4l2");
  const hasGstreamerCamera = deviceCameras.some((b) => b.source === "gstreamer");
  const hasNetworkCamera = Object.values(cfg.cameras).some((b) => b.location === "network");
  // Any on-device sidecar (llama, inference, capture) ships its workspace data out
  // of the main scp line and means the engine reaches it over the network at runtime.
  const hasDeviceSidecar = deviceModels.length > 0 || mlDeviceModels.length > 0 || deviceCameras.length > 0;
  // Self-built sidecar images (fh-onnx, fh-camera) are pull_policy:never: unlike
  // llama (pulled from a registry), they must be built and docker-loaded on the
  // controller too, or `docker compose up` fails with "image not found".
  const sidecarTar = (image: string) => `${image.split(":")[0]}.tar`;
  const selfBuiltSidecars: { image: string; build: string }[] = [];
  if (mlDeviceModels.length > 0) {
    const c = spec.components.find((x) => x.name === mlSidecarServiceName());
    if (c) selfBuiltSidecars.push({ image: c.image, build: `docker build -t ${c.image} py/ml-inference` });
  }
  if (deviceCameras.length > 0) {
    const c = spec.components.find((x) => x.name === cameraSidecarServiceName());
    if (c) selfBuiltSidecars.push({ image: c.image, build: `docker build -f go/Dockerfile.camera -t ${c.image} go` });
  }

  // Per-workflow operator notes — only the relevant ones, in this order:
  // provider keys, hardware, external services, on-device models, network models,
  // web search.
  const notes: string[] = [];

  if (hasProviderModel || localProviders.length > 0) {
    notes.push(`## LLM provider keys

${providerBlock}

The engine calls each provider directly with the API key from \`engine.env\`. Without
a key, an Agent node that uses that provider's catalog model fails at build.`);
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

The broker/endpoint credentials the engine connects with live in \`engine.env\`
(\`FH_RESOURCE_SECRETS\`) — keep it \`chmod 600\`. This bundle does not start those
services; it assumes the broker/endpoint already exists and is reachable from the
controller.`);
  }
  if (deviceModels.length > 0) {
    notes.push(`## On-device models

This bundle runs a llama-server container per on-device model; the engine reaches it
over the compose network by service name. Each GGUF must sit in that model's workspace
dir below (read-only mounted into its container). They are too large for the main
\`scp\` line, so step 3 transfers them separately:
${deviceModels.map((m) => `- \`${m.dir}/${m.file}\``).join("\n")}`);
  }
  if (mlDeviceModels.length > 0) {
    notes.push(`## On-device ML models

This bundle runs one shared inference sidecar (\`${mlSidecarServiceName()}\`) that loads a
repository of ML models; the engine reaches it over the compose network by service name.
Drop each model's \`model.onnx\` + \`manifest.yaml\` into its own sub-folder of the shared
repository dir below (read-only mounted into the sidecar), then transfer the workspaces
tree in step 3:
${mlDeviceModels.map((id) => `- \`${mlRepoDir}/${id}/\``).join("\n")}`);
  }
  if (deviceCameras.length > 0) {
    const parts = [
      `## On-device cameras

This bundle runs one shared capture sidecar (\`${cameraSidecarServiceName()}\`) that reads your
cameras; the engine reaches it over the compose network by service name. The name→source
mapping is in \`${cameraDir}/cameras.json\` (already generated, shipped with the workspaces tree).`,
    ];
    if (hasV4l2Camera) {
      parts.push(`USB/UVC (v4l2) cameras are passed into the sidecar via \`devices:\` in the compose file.
A v4l2 device can also be a statically configured capture node of a CSI/ISP media graph
(set up host-side with \`media-ctl\`, e.g. when the board kernel cannot run libcamera's
software ISP). Configure the graph before \`compose up\` — it resets on reboot, so a boot
script is typical — and set the CAMERA channel's width/height to exactly the pinned format.`);
    }
    if (hasGstreamerCamera) {
      parts.push(`GStreamer/CSI cameras (e.g. \`libcamerasrc\`) discover devices through the host's udev
database — the compose file already mounts \`/run/udev\` read-only for that. They drive the
full media graph, which has no single device node to pass through: grant the sidecar the
relevant nodes yourself via \`devices:\` — typically \`/dev/media*\`, \`/dev/video*\` and
\`/dev/v4l-subdev*\`. Raw-Bayer-only sensors are debayered by libcamera's software ISP,
which needs dma-buf support in the host kernel (\`CONFIG_DMABUF_HEAPS\` → \`/dev/dma_heap/*\`,
or \`CONFIG_UDMABUF\`); on vendor kernels lacking both, use a host-side configured v4l2
node instead (see above).`);
    }
    notes.push(parts.join("\n\n"));
  }
  if (hasNetworkModel) {
    notes.push(`## Network models

A network model points at an inference endpoint **you run yourself** (llama-server, vLLM,
Ollama, ...) on another machine. This bundle does not start that server for you.`);
  }
  if (hasNetworkMLModel) {
    notes.push(`## Network ML models

A network ML model points at an inference sidecar **you run yourself** on another machine.
This bundle does not start that server for you.`);
  }
  if (hasNetworkCamera) {
    notes.push(`## Network cameras

A network camera points at a capture endpoint **you run yourself** on another machine.
This bundle does not start that sidecar for you.`);
  }
  if (cfg.webSearch) {
    notes.push(`## Web search

The web-search API key is in \`engine.env\` (\`ENGINE_WEB_SEARCH_API_KEY\`).`);
  }
  const notesBlock = notes.length ? "\n" + notes.join("\n\n") + "\n" : "";

  // On-device model weights ship outside the main scp line (GGUF/ONNX bundles can
  // be several GB).
  const modelsTransfer = hasDeviceSidecar
    ? `

# On-device sidecar data (model weights, camera config) lives under workspaces/ — kept out
# of the line above (GGUF/ONNX bundles can be several GB). Copy the whole tree:
scp -r workspaces/ $CONTROLLER_USER@$CONTROLLER_ADDR:~/fh-engine/
# ...or download the model files directly into ~/fh-engine/workspaces/<...>/ on the controller.`
    : "";

  // Self-built sidecar images are loaded on the controller alongside the engine
  // (llama is pulled by compose, so it needs no load).
  const sidecarLoadBlock = selfBuiltSidecars
    .map((s) => `ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker load -i ${sidecarTar(s.image)}'\n`)
    .join("");

  // With an on-device sidecar there is no start-ordering: the engine connects to
  // the sidecar over the compose network at runtime, retrying until it is up,
  // so show every container while it settles. Otherwise the engine log alone does.
  const runBlock = hasDeviceSidecar
    ? `ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker load -i fh-engine.tar'
${sidecarLoadBlock}ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose up -d'

# The engine and its sidecar(s) start independently; the engine reaches them once
# they are up. These show every container, not just the engine:
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose ps'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose logs -f'`
    : `ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker load -i fh-engine.tar'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose up -d'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose logs -f engine'`;

  const sidecarBuildBlock =
    selfBuiltSidecars.length === 0
      ? ""
      : `\n\nBuild the on-device sidecar image${selfBuiltSidecars.length > 1 ? "s" : ""} the same way — ${
          selfBuiltSidecars.length > 1 ? "they are" : "it is"
        } never pulled from a registry:\n\n\`\`\`bash\n${selfBuiltSidecars.map((s) => s.build).join("\n")}\n\`\`\``;
  const sidecarSaveBlock = selfBuiltSidecars
    .map((s) => `\ndocker save ${s.image} -o ../path/to/this/bundle/${sidecarTar(s.image)}`)
    .join("");
  const sidecarTars = selfBuiltSidecars.map((s) => sidecarTar(s.image)).join(" ");

  return `# Edge Agents engine — deployment bundle

Generated by \`fh-workflow deploy\`. This directory contains everything needed to
run one engine instance on an edge controller, **standalone** — the engine boots
the workflow from \`engine-config.json\` and runs it autonomously:

- \`docker-compose.yml\` — deployment template
- \`engine-config.json\` — the engine's single boot config (workflow + bindings + device manifest)
- \`deployment-spec.json\` — the full resolved deployment spec (deployment record)
- \`engine.env\` — operator configuration loaded into the engine (already filled in, \`chmod 600\` it)
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
\`\`\`${sidecarBuildBlock}

## 2. Review the generated \`engine.env\`

\`\`\`bash
chmod 600 engine.env
\`\`\`

The wizard already filled in your operator values. Double-check before
transferring — secrets are in plaintext.

## 3. Save the image and transfer to the controller

\`\`\`bash
export CONTROLLER_USER=<your-user>
export CONTROLLER_ADDR=<controller-ip-or-hostname>

cd go
docker save fh-engine:latest -o ../path/to/this/bundle/fh-engine.tar${sidecarSaveBlock}

ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'mkdir -p ~/fh-engine'

cd path/to/this/bundle
scp fh-engine.tar ${sidecarTars ? sidecarTars + " " : ""}docker-compose.yml engine-config.json deployment-spec.json engine.env \\
    $CONTROLLER_USER@$CONTROLLER_ADDR:~/fh-engine/${modelsTransfer}
\`\`\`

## 4. Run (on the controller)

\`\`\`bash
${runBlock}
\`\`\`

## Agent memory & durable data

Each container's durable data is a plain host directory in this bundle,
\`./workspaces/<container>/\` (mounted read-write at \`/var/lib/foresthub/workspace\`):

- \`./workspaces/engine/\` — the engine's memory files.
- \`./workspaces/<model>/\` — an on-device model's GGUF weights (see above).

These are ordinary files: back them up by copying the folder, inspect them directly.
They persist across restarts and redeploys **as long as you keep this bundle directory
stable** — deploy into the same path each time; a fresh directory starts empty. This
bundle is the only copy; there is no backend mirror.
`;
}

// Exported for testing purposes only.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
