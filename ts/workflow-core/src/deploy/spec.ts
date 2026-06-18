// The spec resolver: (workflow + bindings) -> DeploymentSpec. The shared
// "packaging library" the migration doc calls for — component-set derivation
// and device-grant resolution computed once here, frozen into the contract spec,
// so neither renderer (OSS one-shot CLI, paid nucleus) re-derives them.
//
// Every produced field is typed against the generated deployment contract, so a
// contract change stops this compiling — the drift guard for the spec.

import type { Workflow } from "../workflow";
import { serialize } from "../workflow";
import type { DeploymentSchemas } from "../api";
import { deriveRequirements } from "./requirements";
import type { DeployRequirements, HardwareChannel, HardwareFamily } from "./requirements";
import type { DeploymentInputs, HardwareBinding } from "./inputs";

type DeploymentSpec = DeploymentSchemas["DeploymentSpec"];
type EngineConfig = DeploymentSchemas["EngineConfig"];

// Deploy-time metadata the resolver cannot derive from the workflow: identity,
// lifecycle, and the explicit image tags each component runs (never "latest").
export interface DeploymentSpecMeta {
  id: string;
  status: DeploymentSpec["status"];
  createdAt?: string;
  engineVersion: string;
  llamaServerVersion: string;
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

// Host of a broker URL, for a readable ref. "mqtt" when unparseable.
function brokerHost(url: string): string {
  try {
    return new URL(url).hostname || "mqtt";
  } catch {
    return "mqtt";
  }
}

// Compose/container service name for an on-device model's llama-server sidecar.
// Single source of truth: the resolver derives the provider URL from it and the
// renderer emits a service with the same name — they must agree or the URL
// points at a service that doesn't exist.
export function sidecarServiceName(modelId: string): string {
  const slug = modelId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `llama-${slug || "model"}`;
}

// Why an on-device model filename is unacceptable, or null when fine. A name
// check only — the file doesn't exist yet at spec time. Shared with the prompts
// so input collection and the resolver reject the same input.
export function ggufNameError(name: string | undefined): string | null {
  const t = (name ?? "").trim();
  if (!t) return "a model filename is required";
  if (!t.toLowerCase().endsWith(".gguf")) return "must be a .gguf file (llama-server only loads GGUF)";
  if (t.includes("/")) return "just the filename, not a path — the file goes in ./models/";
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
  for (const m of req.customModels) {
    const b = inputs.models[m.id];
    if (b?.location === "device") {
      const err = ggufNameError(b.modelFile);
      if (err) missing.push(`model "${m.id}": ${err}`);
    } else if (!b?.url) {
      missing.push(`model "${m.id}": endpoint URL`);
    }
  }
  missing.push(...hardwareConflicts(req.hardwareChannels, inputs.hardware));
  missing.push(...familyMismatches(req.hardwareChannels, inputs.hardware));
  if (missing.length > 0) {
    throw new Error(`invalid deploy config:\n  - ${missing.join("\n  - ")}`);
  }
}

// buildDeploymentSpec resolves a workflow plus its bindings into a complete,
// contract-defined DeploymentSpec. Throws (via assertDeployable) if any declared
// resource is unbound. The embedded engine config carries the serialized (and
// thereby pruned) workflow; device grants and privileged are resolved here.
export function buildDeploymentSpec(
  workflow: Workflow,
  inputs: DeploymentInputs,
  meta: DeploymentSpecMeta,
): DeploymentSpec {
  const req = deriveRequirements(workflow);
  assertDeployable(req, inputs);

  const refs = new RefAllocator();

  // DeviceManifest is split per family; accumulate each separately, attach only
  // the non-empty ones (all slots optional).
  const gpios: Record<string, DeploymentSchemas["GPIOConfig"]> = {};
  const adcs: Record<string, DeploymentSchemas["ADCConfig"]> = {};
  const dacs: Record<string, DeploymentSchemas["DACConfig"]> = {};
  const pwms: Record<string, DeploymentSchemas["PWMConfig"]> = {};
  const serials: Record<string, DeploymentSchemas["SerialConfig"]> = {};

  const externalResources: DeploymentSchemas["ExternalResources"] = {};
  const mapping: DeploymentSchemas["DeploymentMapping"] = {};

  // Container-level hardware access, resolved once: cdev nodes (GPIO, UART) map
  // one-to-one into deviceGrants; sysfs families (ADC/DAC/PWM) have no single
  // node, so the engine container runs privileged.
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
    const conn: DeploymentSchemas["MQTTConnection"] = { type: "mqtt", brokerUrl: b.brokerUrl };
    if (b.username) conn.username = b.username;
    if (b.password) conn.password = b.password;
    const ref = refs.alloc(`mqtt:${JSON.stringify(conn)}`, `mqtt-${brokerHost(b.brokerUrl)}`);
    externalResources[ref] = conn;
    mapping[ch.id] = { ref };
  }

  // Custom models: one self-hosted provider per model id. A device model points
  // at the sidecar we run (over the container network, no key); a network model
  // at the operator's endpoint. `model` is left off — the endpoint serves under
  // the workflow id (no upstream-name aliasing yet).
  const llamaModels: DeploymentSchemas["LlamaModel"][] = [];
  for (const m of req.customModels) {
    const b = inputs.models[m.id];
    if (!b) throw new Error(`unbound model ${m.id}`); // unreachable after assertDeployable
    const url = b.location === "device" ? `http://${sidecarServiceName(m.id)}:8080` : b.url;
    const provider: DeploymentSchemas["LLMProviderConfig"] = { type: "selfhosted", url };
    if (b.location === "network" && b.apiKey) provider.apiKey = b.apiKey;
    const ref = refs.alloc(`model:${m.id}`, basename(m.id));
    externalResources[ref] = provider;
    mapping[m.id] = { ref };
    if (b.location === "device") llamaModels.push({ id: m.id, modelFile: b.modelFile });
  }

  const manifest: DeploymentSchemas["DeviceManifest"] = {};
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

  const engine: DeploymentSchemas["EngineComponent"] = { version: meta.engineVersion, config };
  if (cdev.size > 0) engine.deviceGrants = [...cdev];
  if (privileged) engine.privileged = true;

  const components: DeploymentSchemas["ComponentSet"] = { engine };
  if (llamaModels.length > 0) {
    components.llamaServer = { version: meta.llamaServerVersion, models: llamaModels };
  }

  const spec: DeploymentSpec = {
    schemaVersion: 1,
    id: meta.id,
    status: meta.status,
    components,
  };
  if (meta.createdAt) spec.createdAt = meta.createdAt;
  return spec;
}
