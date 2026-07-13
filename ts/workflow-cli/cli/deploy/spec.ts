// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// The spec resolver: (workflow + bindings) -> DeploymentSpec. The OSS CLI's
// packaging step — component-set derivation and device-grant resolution computed
// here, frozen into the contract spec, so the renderer (composeYaml) never
// re-derives them. The paid backend has its own resolver; the two share only the
// DeploymentSpec contract and the Stage-0 binding surface, not this code.
//
// Every produced field is typed against the generated deployment contract, so a
// contract change stops this compiling — the drift guard for the spec.

import type { DeploymentSchemas, EngineSchemas } from "@foresthubai/workflow-core/api";
import type { Workflow } from "@foresthubai/workflow-core/workflow";
import { serialize } from "@foresthubai/workflow-core/workflow";
import type { ModelInfo } from "@foresthubai/workflow-core/model";
import type { DeploymentInputs, HardwareBinding } from "./inputs";
import type { DeployRequirements, HardwareChannel, HardwareFamily } from "@foresthubai/workflow-core/deploy";
import { deriveRequirements } from "@foresthubai/workflow-core/deploy";
import { COMPONENT_CONFIG_PATH, COMPONENT_WORKSPACE_PATH, ENGINE_COMPONENT_NAME, CAMERA_COMPONENT_NAME, ML_COMPONENT_NAME, LLAMA_COMPONENT_NAME } from "@foresthubai/workflow-core/deploy";

type DeploymentSpec = DeploymentSchemas["DeploymentSpec"];
type DeployComponent = DeploymentSchemas["DeployComponent"];
// Typed against the engine's own contract (engine.yaml), not the deployment one:
// the spec carries it as an opaque blob in DeployComponent.config.
type EngineConfig = EngineSchemas["EngineConfig"];

// One model in the llama-server config.json (its models list). Produced here and read
// by the image entrypoint (components/llama-server/entrypoint.sh) — deliberately NOT a
// contract type: its only consumer is that bash entrypoint, which owns the shape and
// hand-parses it. Keep in sync with the entrypoint.
interface LlamaModel {
  id: string;
  file: string;
  args?: string[];
}

// The inference component's fixed listen port (baked into its image entrypoint).
const ML_COMPONENT_PORT = 8000;

// The capture component's fixed listen port (baked into its image entrypoint).
const CAMERA_COMPONENT_PORT = 8100;

// The llama-server component's fixed listen port (llama-swap's endpoint, baked into
// its image entrypoint).
const LLAMA_COMPONENT_PORT = 8080;

// The OSS renderer's state root (see docs/deployment-pipeline.md). Bind-mount sources
// hang off it as `<root>/workspaces/<container>/`. "." makes Docker resolve them
// relative to the compose file, so the bundle stays drop-anywhere; Ranger is a
// separate renderer that sets root to the absolute `/var/lib/foresthub`.
const STATE_ROOT = ".";

// Host bind-mount source for a container's workspace under the state root.
function workspaceDir(container: string): string {
  return `${STATE_ROOT}/workspaces/${container}`;
}

// Deploy-time metadata the resolver cannot derive from the workflow: identity,
// lifecycle, and the full image reference each component runs (frozen here so the
// renderer emits a coordinate rather than assembling one). llamaServerImage is
// used only when the workflow has an on-device model.
export interface DeploymentSpecMeta {
  id: string;
  createdAt?: string;
  engineImage: string;
  llamaServerImage: string;
  mlComponentImage: string;
  cameraComponentImage: string;
}

// The engine's secret store: a flat map of secret id -> opaque secret value,
// keyed by the same resource ref the spec's externalResources use. Each value is
// the single credential that resource needs (MQTT password, self-hosted-LLM
// bearer token). Secrets are NEVER part of the spec (not rotation-safe, breach-
// exposed if stored): the resolver returns them separately, for the renderer to
// deliver out-of-band as a mounted secret document (secrets.json). Mirrors the
// wire EngineSecrets.
export type EngineSecrets = Record<string, string>;

// buildDeploymentSpec's output: the secret-free spec plus the pulled-out secrets.
export interface DeploymentSpecResult {
  spec: DeploymentSpec;
  resourceSecrets: EngineSecrets;
}

// Hands out stable, collision-free ref names. Same dedup key -> same ref (the
// engine builds that resource once); distinct keys preferring the same name get
// suffixed (-2, -3, ...) so the flat ref namespace stays unambiguous.
class RefAllocator {
  private readonly byKey = new Map<string, string>();
  private readonly used = new Set<string>();

  alloc(key: string, hint: string): string {
    const existing = this.byKey.get(key);
    if (existing) return existing;
    let ref = hint;
    for (let n = 2; this.used.has(ref); n++) ref = `${hint}-${n}`;
    this.used.add(ref);
    this.byKey.set(key, ref);
    return ref;
  }
}

// Last path/URL segment, reduced to a safe ref token.
// "/dev/gpiochip0" -> "gpiochip0", ".../iio:device0" -> "iio:device0".
function basename(p: string): string {
  const tail = p.replace(/\/+$/, "").split("/").pop() ?? p;
  return tail.replace(/[^A-Za-z0-9._:-]/g, "-") || "res";
}

// Host of a URL, for a readable ref (MQTT broker / self-hosted endpoint).
// Falls back to "host" when unparseable.
function urlHost(url: string): string {
  try {
    return new URL(url).hostname || "host";
  } catch {
    return "host";
  }
}

// Compose/container service name for the shared llama-server component. Like the
// inference component, one container fronts a set of on-device models (llama-swap) and
// selects one by id per request — so this is a fixed name, its canonical identity, not
// derived from any model id. Every on-device model's provider URL points at it.
export function llamaComponentServiceName(): string {
  return LLAMA_COMPONENT_NAME;
}

// Compose/container service name for the shared inference component. Unlike the
// llama component (one per model), a single inference component hosts a repository
// of ML models and selects one by name per request — so this is a fixed name, its
// canonical identity, not derived from any model id. Every on-device ML model's
// provider URL points at it.
export function mlComponentServiceName(): string {
  return ML_COMPONENT_NAME;
}

// Compose/container service name for the shared capture component. Like the
// inference component (one container owns a set of cameras and selects one by name
// per request), this is a fixed name, its canonical identity, not derived from any
// channel id. Every on-device camera's connection URL points at it.
export function cameraComponentServiceName(): string {
  return CAMERA_COMPONENT_NAME;
}

// Why an on-device model filename is unacceptable, or null when fine. A name
// check only — the file doesn't exist yet at spec time. Shared with the prompts
// so input collection and the resolver reject the same input.
export function ggufNameError(name: string | undefined): string | null {
  const t = (name ?? "").trim();
  if (!t) return "a model filename is required";
  if (!t.toLowerCase().endsWith(".gguf")) return "must be a .gguf file (llama-server only loads GGUF)";
  if (t.includes("/")) return "just the filename, not a path — the file goes in the llama-server workspace dir (./workspaces/llama-server/)";
  return null;
}

// The name the inference component selects a model on. On device it also names the
// model's sub-folder in the component's repository, so it must be a plain name.
export function mlModelNameError(name: string | undefined): string | null {
  const t = (name ?? "").trim();
  if (!t) return "a model name is required";
  if (t.includes("/")) return "just a name, not a path — it names the model's sub-folder in the component repository";
  return null;
}

// A physical address belongs to exactly one channel — the engine doesn't police
// this and would silently let the last claimer win. Same key = collision;
// sharing just a chip path is fine (one chip, many lines), except serial where
// the path IS the device. Exported so input collection (prompts) can reject a
// duplicate at entry with the same identity the resolver validates against.
export function hardwareAddressKey(family: HardwareFamily, chipOrDevice: string, index?: number): string {
  const dev = chipOrDevice.trim();
  return family === "serial" ? `serial:${dev}` : `${family}:${dev}:${index}`;
}

// The same address phrased for an error message: "/dev/gpiochip0 line 17".
export function hardwareAddressLabel(family: HardwareFamily, chipOrDevice: string, index?: number): string {
  const dev = chipOrDevice.trim();
  if (family === "serial") return dev;
  return `${dev} ${family === "gpio" ? "line" : "channel"} ${index}`;
}

// One message per channel whose address an earlier channel already claimed.
// Incomplete bindings are skipped (completeness is checked separately).
export function hardwareConflicts(channels: HardwareChannel[], bindings: Record<string, HardwareBinding>): string[] {
  const conflicts: string[] = [];
  const claimed = new Map<string, string>(); // address key -> channel id holding it
  for (const ch of channels) {
    const b = bindings[ch.id];
    if (!b?.chipOrDevice || (ch.addressable && b.index === undefined)) continue;
    const key = hardwareAddressKey(ch.family, b.chipOrDevice, b.index);
    const holder = claimed.get(key);
    if (holder) {
      conflicts.push(`hardware "${ch.id}": ${hardwareAddressLabel(ch.family, b.chipOrDevice, b.index)} is already used by "${holder}"`);
    } else {
      claimed.set(key, ch.id);
    }
  }
  return conflicts;
}

// One message per binding carrying a field its family doesn't have (`baud` is
// serial-only, `index` is everything-but-serial). Usually a mixed-up channel id
// in a machine-written binding set — reject loudly instead of ignoring.
export function familyMismatches(channels: HardwareChannel[], bindings: Record<string, HardwareBinding>): string[] {
  const mismatches: string[] = [];
  for (const ch of channels) {
    const b = bindings[ch.id];
    if (!b) continue;
    if (ch.family !== "serial" && b.baud !== undefined) {
      mismatches.push(`hardware "${ch.id}": "baud" only applies to serial channels (this is a ${ch.family} channel)`);
    }
    if (ch.family === "serial" && b.index !== undefined) {
      mismatches.push(`hardware "${ch.id}": "index" does not apply to serial channels (the device path is the full address)`);
    }
  }
  return mismatches;
}

// Exhaustiveness guard over HardwareFamily — a new family breaks compilation
// here until handled.
function assertNeverFamily(f: never): never {
  throw new Error(`unhandled hardware family: ${String(f)}`);
}

// Mirror of the engine's deploy-layer validation: every declared resource must
// carry a binding or the engine fatals at boot. Collects ALL gaps so a caller
// sees them at once. Throws on any gap — the last guard before a dead spec.
export function assertDeployable(req: DeployRequirements, inputs: DeploymentInputs): void {
  const missing: string[] = [];
  for (const ch of req.hardwareChannels) {
    const b = inputs.hardware[ch.id];
    if (!b?.chipOrDevice) missing.push(`hardware "${ch.id}": device path`);
    else if (ch.addressable && b.index === undefined) missing.push(`hardware "${ch.id}": index`);
  }
  for (const ch of req.mqttChannels) {
    if (!inputs.mqtt[ch.id]?.brokerUrl) missing.push(`mqtt "${ch.id}": broker URL`);
  }
  for (const m of req.customLLMModels) {
    const b = inputs.llmModels[m.id];
    if (b?.location === "device") {
      const err = ggufNameError(b.modelFile);
      if (err) missing.push(`model "${m.id}": ${err}`);
    } else if (!b?.url) {
      missing.push(`model "${m.id}": endpoint URL`);
    }
  }
  for (const m of req.customMLModels) {
    const b = inputs.mlModels[m.id];
    // Both locations need a model name; network additionally needs its endpoint URL.
    const nameErr = mlModelNameError(b?.model);
    if (nameErr) missing.push(`model "${m.id}": ${nameErr}`);
    if (b?.location !== "device" && !b?.url) missing.push(`model "${m.id}": on-device or endpoint URL`);
  }
  for (const ch of req.cameraChannels) {
    const b = inputs.cameras[ch.id];
    // device needs a capture source device (v4l2 path or gstreamer element);
    // network needs its endpoint URL.
    if (b?.location === "device") {
      if (!b.device) missing.push(`camera "${ch.id}": capture source device`);
    } else if (!b?.url) {
      missing.push(`camera "${ch.id}": on-device source or endpoint URL`);
    }
  }
  for (const p of req.catalogProviders) {
    const b = inputs.providers?.[p.id];
    if (!b) missing.push(`provider "${p.id}": routing (local or backend)`);
    else if (b.routing === "local" && !b.apiKey) missing.push(`provider "${p.id}": API key`);
  }
  // A referenced catalog model absent from the catalog can't be routed — the
  // engine would have no provider for it. Refuse rather than emit a dead spec.
  for (const id of req.unresolvedCatalogModels) missing.push(`model "${id}": not in the model catalog`);
  missing.push(...hardwareConflicts(req.hardwareChannels, inputs.hardware));
  missing.push(...familyMismatches(req.hardwareChannels, inputs.hardware));
  if (missing.length > 0) {
    throw new Error(`invalid deploy config:\n  - ${missing.join("\n  - ")}`);
  }
}

// One compose service per name: a duplicate name would collapse two components
// onto one service and silently drop the loser. Names only — same image under
// different names is legitimate (e.g. two grafanas).
function assertNoNameCollisions(components: DeployComponent[]): void {
  const seen = new Set<string>();
  for (const c of components) {
    if (seen.has(c.name)) throw new Error(`duplicate component name "${c.name}"`);
    seen.add(c.name);
  }
}

// buildDeploymentSpec resolves a workflow plus its bindings into a complete,
// contract-defined DeploymentSpec. Throws (via assertDeployable) if any declared
// resource is unbound. The embedded engine config carries the serialized (and
// thereby pruned) workflow; device grants and privileged are resolved here.
// customComponents are operator-authored containers, merged in verbatim.
export function buildDeploymentSpec(
  workflow: Workflow,
  inputs: DeploymentInputs,
  meta: DeploymentSpecMeta,
  customComponents: DeployComponent[] = [],
  catalog: ModelInfo[] = [],
): DeploymentSpecResult {
  const req = deriveRequirements(workflow, catalog);
  assertDeployable(req, inputs);

  const refs = new RefAllocator();
  const resourceSecrets: EngineSecrets = {};

  // DeviceManifest is split per family; accumulate each separately, attach only
  // the non-empty ones (all slots optional).
  const gpios: Record<string, EngineSchemas["GPIOConfig"]> = {};
  const adcs: Record<string, EngineSchemas["ADCConfig"]> = {};
  const dacs: Record<string, EngineSchemas["DACConfig"]> = {};
  const pwms: Record<string, EngineSchemas["PWMConfig"]> = {};
  const serials: Record<string, EngineSchemas["SerialConfig"]> = {};

  const externalResources: EngineSchemas["ExternalResources"] = {};
  const mapping: EngineSchemas["ResourceMapping"] = {};

  // Container-level hardware access, resolved once: cdev nodes (GPIO, UART) map
  // one-to-one into the engine component's devices; sysfs families (ADC/DAC/PWM)
  // have no single node, so the engine container runs privileged.
  const cdev = new Set<string>();
  let privileged = false;

  // Hardware: one driver instance per distinct device path (dedup by
  // family+path); one mapping per channel carrying its per-channel index.
  for (const ch of req.hardwareChannels) {
    const b = inputs.hardware[ch.id];
    if (!b) throw new Error(`unbound hardware channel ${ch.id}`); // unreachable after assertDeployable
    const dev = b.chipOrDevice;
    const ref = refs.alloc(`hw:${ch.family}:${dev}`, basename(dev));

    switch (ch.family) {
      case "gpio":
        gpios[ref] = { chip: dev };
        cdev.add(dev);
        break;
      case "serial":
        serials[ref] = b.baud ? { device: dev, baud: b.baud } : { device: dev };
        cdev.add(dev);
        break;
      case "pwm":
        pwms[ref] = { chip: dev };
        privileged = true;
        break;
      case "adc":
        adcs[ref] = { device: dev };
        privileged = true;
        break;
      case "dac":
        dacs[ref] = { device: dev };
        privileged = true;
        break;
      default:
        return assertNeverFamily(ch.family);
    }

    if (ch.addressable && b.index !== undefined) mapping[ch.id] = { ref, index: b.index };
    else mapping[ch.id] = { ref };
  }

  // MQTT: one connection per distinct config (dedup by full content — same
  // broker, different creds is a different resource). No index.
  for (const ch of req.mqttChannels) {
    const b = inputs.mqtt[ch.id];
    if (!b) throw new Error(`unbound mqtt channel ${ch.id}`); // unreachable
    const conn: EngineSchemas["MQTTConnection"] = { type: "mqtt", brokerUrl: b.brokerUrl };
    if (b.username) conn.username = b.username;
    // The password is a secret — kept out of conn (and thus the spec). It still
    // participates in the dedup key, so two channels differing only by password
    // don't collapse onto one ref (and one shared secret).
    const ref = refs.alloc(`mqtt:${JSON.stringify(conn)}:${b.password ?? ""}`, `mqtt-${urlHost(b.brokerUrl)}`);
    externalResources[ref] = conn;
    mapping[ch.id] = { ref };
    if (b.password) resourceSecrets[ref] = b.password;
  }

  // Custom LLM models: each maps to a selfhosted provider. Every on-device model is
  // served by ONE shared llama-server that fronts them with llama-swap and selects one
  // by id per request — so they all point at the same service URL and only a single
  // component is emitted (mirrors the inference component). A network model points at
  // the operator's endpoint — deduped by url+key, so several models on one endpoint
  // share ONE provider (many models -> one ref, like GPIO lines on one chip). The engine
  // sends the model's workflow id, which llama-swap routes on (the config.json `id`).
  const llamaComponents: DeployComponent[] = [];
  const llamaModels: LlamaModel[] = [];
  for (const m of req.customLLMModels) {
    const b = inputs.llmModels[m.id];
    if (!b) throw new Error(`unbound model ${m.id}`); // unreachable after assertDeployable

    if (b.location === "device") {
      const ref = refs.alloc(`model:${m.id}`, basename(m.id));
      mapping[m.id] = { ref };
      externalResources[ref] = { type: "selfhostedLlm", url: `http://${llamaComponentServiceName()}:${LLAMA_COMPONENT_PORT}` };
      // ctx-size is frozen here — retuning it is a re-deploy, not an env edit. The GGUF
      // is a bare filename the entrypoint resolves under the shared component workspace.
      llamaModels.push({ id: m.id, file: b.modelFile, args: ["--ctx-size", String(b.ctxSize ?? 4096)] });
    } else {
      const ref = refs.alloc(`selfhosted:${b.url}:${b.apiKey ?? ""}`, `provider-${urlHost(b.url)}`);
      mapping[m.id] = { ref };
      externalResources[ref] = { type: "selfhostedLlm", url: b.url };
      // The endpoint bearer is a secret — out of the spec, returned separately.
      if (b.apiKey) resourceSecrets[ref] = b.apiKey;
    }
  }
  // One shared llama-server for all on-device models (not one per model). Its config.json
  // (the models list) rides as the component config blob, mounted read-only at the
  // standard config path the entrypoint reads; the GGUF weights sit in the component
  // workspace the operator fills, mounted read-only. No pull override: llama-server is a
  // published image, pulled from its registry (unlike the locally-built engine/ml/camera).
  if (llamaModels.length > 0) {
    const service = llamaComponentServiceName();
    llamaComponents.push({
      name: service,
      image: meta.llamaServerImage,
      config: { models: llamaModels },
      volumes: [`${workspaceDir(service)}:${COMPONENT_WORKSPACE_PATH}:ro`],
    });
  }

  // Catalog providers: one provider instance per referenced provider — NO mapping.
  // The engine registers all of these into its single llmproxy, which routes each
  // catalog model by id. Each provider is served by exactly one instance (local
  // xor backend), so there's no overlap and no catch-all. `localLlm` carries the
  // adapter id + a deploy-delivered key (secret by ref); `backendLlm` carries the
  // adapter id and no key — its models are proxied to the backend. Unresolved refs
  // are already rejected by assertDeployable.
  for (const p of req.catalogProviders) {
    const b = inputs.providers?.[p.id];
    if (!b) throw new Error(`unbound catalog provider ${p.id}`); // unreachable after assertDeployable
    const ref = refs.alloc(`provider:${p.id}`, `provider-${p.id}`);
    if (b.routing === "local") {
      externalResources[ref] = { type: "localLlm", provider: p.id };
      if (b.apiKey) resourceSecrets[ref] = b.apiKey;
    } else {
      externalResources[ref] = { type: "backendLlm", provider: p.id };
    }
  }

  // ML models: every on-device model is served by ONE shared inference component
  // that loads a repository of model bundles (a sub-folder per model id) and
  // selects the model by name per request — so they all point at the same service
  // URL and only a single component is emitted. A network model points at the
  // operator's own component. Credential-free — a trusted in-deployment endpoint.
  const mlComponents: DeployComponent[] = [];
  let mlDeviceModels = 0;
  for (const m of req.customMLModels) {
    const b = inputs.mlModels[m.id];
    if (!b) throw new Error(`unbound model ${m.id}`); // unreachable after assertDeployable
    const ref = refs.alloc(`ml-model:${m.id}`, basename(m.id));
    mapping[m.id] = { ref };

    if (b.location === "device") {
      externalResources[ref] = {
        type: "ml-inference",
        url: `http://${mlComponentServiceName()}:${ML_COMPONENT_PORT}`,
        model: b.model,
      };
      mlDeviceModels++;
    } else {
      externalResources[ref] = { type: "ml-inference", url: b.url, model: b.model };
    }
  }
  // One shared component for all on-device ML models (not one per model). The model
  // repository is a directory the operator fills, one sub-folder per model id, mounted
  // read-only at the standard workspace path (so no chown, no env var is wired).
  if (mlDeviceModels > 0) {
    const service = mlComponentServiceName();
    mlComponents.push({
      name: service,
      image: meta.mlComponentImage,
      pull: "never", // built locally before deploy, in no registry
      volumes: [`${workspaceDir(service)}:${COMPONENT_WORKSPACE_PATH}:ro`],
    });
  }

  // Cameras: every on-device camera is read by ONE shared capture component that
  // owns a set of cameras (one cameras.json entry per channel id) and selects one
  // by name per request — so they all point at the same service URL and only a
  // single component is emitted. A network camera points at the operator's own
  // capture endpoint. Credential-free — a trusted in-deployment endpoint.
  const cameraComponents: DeployComponent[] = [];
  let cameraDeviceCount = 0;
  let hasGstreamerCamera = false;
  const cameraDevices = new Set<string>();
  for (const ch of req.cameraChannels) {
    const b = inputs.cameras[ch.id];
    if (!b) throw new Error(`unbound camera ${ch.id}`); // unreachable after assertDeployable
    const ref = refs.alloc(`camera:${ch.id}`, basename(ch.id));
    mapping[ch.id] = { ref };

    if (b.location === "device") {
      externalResources[ref] = { type: "camera", url: `http://${cameraComponentServiceName()}:${CAMERA_COMPONENT_PORT}` };
      cameraDeviceCount++;
      // v4l2 reads a /dev/video* node, passed through to the component container. A
      // gstreamer source (e.g. libcamerasrc) drives the full media graph, which
      // has no single node to grant here — the operator wires those devices in.
      if (b.source === "v4l2") cameraDevices.add(b.device);
      else hasGstreamerCamera = true;
      // Nodes the binding's setup commands touch (media graph, subdevices).
      for (const d of b.devices ?? []) cameraDevices.add(d);
    } else {
      externalResources[ref] = { type: "camera", url: b.url };
    }
  }
  // One shared component for all on-device cameras (not one per camera). The camera
  // set is described by cameras.json (one entry per channel id), bind-mounted
  // read-only at the standard component config path — the same config.json every
  // component boots from, so no env var is wired.
  if (cameraDeviceCount > 0) {
    const service = cameraComponentServiceName();
    const volumes = [`${workspaceDir(service)}/cameras.json:${COMPONENT_CONFIG_PATH}:ro`];
    // libcamera (gstreamer sources) discovers cameras through the host's udev
    // device database; without this mount the component sees no camera at all.
    if (hasGstreamerCamera) volumes.push("/run/udev:/run/udev:ro");
    const camera: DeployComponent = {
      name: service,
      image: meta.cameraComponentImage,
      pull: "never", // built locally before deploy, in no registry
      volumes,
    };
    if (cameraDevices.size > 0) camera.devices = [...cameraDevices];
    cameraComponents.push(camera);
  }

  const manifest: EngineSchemas["DeviceManifest"] = {};
  if (Object.keys(gpios).length) manifest.gpios = gpios;
  if (Object.keys(adcs).length) manifest.adcs = adcs;
  if (Object.keys(dacs).length) manifest.dacs = dacs;
  if (Object.keys(pwms).length) manifest.pwms = pwms;
  if (Object.keys(serials).length) manifest.serials = serials;

  // The engine's boot input. workflow is serialized (and thereby pruned) from
  // the domain. The optional sections attach only when non-empty — an absent
  // section is correct, not a gap, and matches what the engine skips.
  const config: EngineConfig = { workflow: serialize(workflow) };
  if (Object.keys(mapping).length) config.mapping = mapping;
  if (Object.keys(externalResources).length) config.externalResources = externalResources;
  if (Object.keys(manifest).length) config.manifest = manifest;

  // The engine component. The config blob is mounted at the fixed convention path
  // (component.ConfigFile) the engine image reads.
  const engine: DeployComponent = {
    name: ENGINE_COMPONENT_NAME,
    image: meta.engineImage,
    pull: "never", // built locally before deploy, in no registry
    config,
    // Durable memory: a host bind mount under the state root, read-write, at the
    // in-container workspace path (COMPONENT_WORKSPACE_PATH; docs/component-contract.md).
    volumes: [`${workspaceDir(ENGINE_COMPONENT_NAME)}:${COMPONENT_WORKSPACE_PATH}`],
    // Run as root: writes the rw workspace bind mount without a host chown step
    // (the OSS default), and also opens root-owned device nodes when hardware
    // (cdev passthrough / sysfs-privileged) is mapped in below.
    user: "0:0",
  };
  if (cdev.size > 0) engine.devices = [...cdev];
  if (privileged) engine.privileged = true;

  const components = [engine, ...llamaComponents, ...mlComponents, ...cameraComponents, ...customComponents];
  assertNoNameCollisions(components);

  const spec: DeploymentSpec = {
    schemaVersion: 1,
    id: meta.id,
    components,
  };
  if (meta.createdAt) spec.createdAt = meta.createdAt;
  return { spec, resourceSecrets };
}
