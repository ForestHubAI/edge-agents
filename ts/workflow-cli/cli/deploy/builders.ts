// Builders: requirements (what the workflow needs) + config (operator answers)
// -> the three deploy wire-files, each typed against the engine contract. A
// contract shape change stops these compiling — the drift guard for the files.

import type { Schemas } from "../../src/api";
import type { DeployConfig, DeployRequirements } from "./types";

// The three files the standalone engine self-deploys from at boot. Built in one
// pass because manifest, resources and mapping must agree on every ref — a ref
// is a sharing identity, so re-deriving it three times would invite drift.
export interface DeployArtifacts {
  deviceManifest: Schemas["DeviceManifest"];
  externalResources: Schemas["ExternalResources"];
  deploymentMapping: Schemas["DeploymentMapping"];
}

// Hands out stable, collision-free ref names. Same dedup key -> same ref (the
// engine then builds that resource once); distinct keys with the same preferred
// name get suffixed (-2, -3, ...) so the flat ref namespace stays unambiguous.
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

// Compose service name for an on-device model's sidecar. Single source of truth:
// builders derive the provider url from it, generate emits the matching service —
// they must agree or the url points at a service that doesn't exist.
export function sidecarServiceName(modelId: string): string {
  const slug = modelId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `llama-${slug || "model"}`;
}

// Exhaustiveness guard over HardwareFamily — a new family widens the switch
// input and breaks compilation here until it is handled (cf. inspect.ts).
function assertNeverFamily(f: never): never {
  throw new Error(`unhandled hardware family: ${String(f)}`);
}

// Client-side mirror of the engine's deploy-layer validation: every declared
// resource must carry a binding or the engine fatals at boot. Last guard before
// a dead bundle; collects ALL gaps so the operator sees them at once.
export function assertDeployable(req: DeployRequirements, cfg: DeployConfig): void {
  const missing: string[] = [];
  for (const ch of req.hardwareChannels) {
    const b = cfg.hardware[ch.id];
    if (!b?.chipOrDevice) missing.push(`hardware "${ch.id}": device path`);
    else if (ch.addressable && b.index === undefined) missing.push(`hardware "${ch.id}": index`);
  }
  for (const ch of req.mqttChannels) {
    if (!cfg.mqtt[ch.id]?.brokerUrl) missing.push(`mqtt "${ch.id}": broker URL`);
  }
  for (const m of req.customModels) {
    const b = cfg.models[m.id];
    if (b?.location === "device") {
      if (!b.modelFile) missing.push(`model "${m.id}": model filename`);
    } else if (!b?.url) {
      missing.push(`model "${m.id}": endpoint URL`);
    }
  }
  if (missing.length > 0) {
    throw new Error(`incomplete deploy config:\n  - ${missing.join("\n  - ")}`);
  }
}

export function buildDeployArtifacts(req: DeployRequirements, cfg: DeployConfig): DeployArtifacts {
  assertDeployable(req, cfg);

  const refs = new RefAllocator();

  // DeviceManifest is split per family; accumulate each family separately, then
  // only attach the non-empty ones at the end (the slots are all optional).
  const gpios: Record<string, Schemas["GPIOConfig"]> = {};
  const adcs: Record<string, Schemas["ADCConfig"]> = {};
  const dacs: Record<string, Schemas["DACConfig"]> = {};
  const pwms: Record<string, Schemas["PWMConfig"]> = {};
  const serials: Record<string, Schemas["SerialConfig"]> = {};

  const externalResources: Schemas["ExternalResources"] = {};
  const deploymentMapping: Schemas["DeploymentMapping"] = {};

  // Hardware: one driver instance per distinct device path (dedup by family+path),
  // one mapping per channel carrying its per-channel index (addressable families).
  for (const ch of req.hardwareChannels) {
    const b = cfg.hardware[ch.id];
    if (!b) throw new Error(`unbound hardware channel ${ch.id}`); // unreachable after assertDeployable
    const dev = b.chipOrDevice;
    const ref = refs.alloc(`hw:${ch.family}:${dev}`, basename(dev));

    switch (ch.family) {
      case "gpio":
        gpios[ref] = { chip: dev };
        break;
      case "pwm":
        pwms[ref] = { chip: dev };
        break;
      case "adc":
        adcs[ref] = { device: dev };
        break;
      case "dac":
        dacs[ref] = { device: dev };
        break;
      case "serial":
        serials[ref] = b.baud ? { device: dev, baud: b.baud } : { device: dev };
        break;
      default:
        return assertNeverFamily(ch.family);
    }

    deploymentMapping[ch.id] = ch.addressable ? { ref, index: b.index } : { ref };
  }

  // MQTT: one connection per distinct config (dedup by full content — same broker
  // with different credentials/prefixes is a different resource). No index.
  for (const ch of req.mqttChannels) {
    const b = cfg.mqtt[ch.id];
    if (!b) throw new Error(`unbound mqtt channel ${ch.id}`); // unreachable
    const conn: Schemas["MQTTConnection"] = { type: "mqtt", brokerUrl: b.brokerUrl };
    if (b.username) conn.username = b.username;
    if (b.password) conn.password = b.password;
    if (b.publishPrefix) conn.publishPrefix = b.publishPrefix;
    if (b.subscribePrefix) conn.subscribePrefix = b.subscribePrefix;

    const ref = refs.alloc(`mqtt:${JSON.stringify(conn)}`, `mqtt-${brokerHost(b.brokerUrl)}`);
    externalResources[ref] = conn;
    deploymentMapping[ch.id] = { ref };
  }

  // Custom models: one self-hosted provider per model id (ids are unique). The
  // mapping is keyed by the model id agent nodes reference. No index. `model` is
  // left off — the endpoint serves the model under its workflow id (the engine has
  // no upstream-name aliasing yet).
  for (const m of req.customModels) {
    const b = cfg.models[m.id];
    if (!b) throw new Error(`unbound model ${m.id}`); // unreachable after assertDeployable
    // device: the url points at the sidecar we generate, over the compose network
    // (no host networking, no key). network: the endpoint the operator gave us.
    const url = b.location === "device" ? `http://${sidecarServiceName(m.id)}:8080` : b.url;
    const provider: Schemas["LLMProviderConfig"] = { type: "selfhosted", url };
    if (b.location === "network" && b.apiKey) provider.apiKey = b.apiKey;

    const ref = refs.alloc(`model:${m.id}`, basename(m.id));
    externalResources[ref] = provider;
    deploymentMapping[m.id] = { ref };
  }

  const deviceManifest: Schemas["DeviceManifest"] = {};
  if (Object.keys(gpios).length) deviceManifest.gpios = gpios;
  if (Object.keys(adcs).length) deviceManifest.adcs = adcs;
  if (Object.keys(dacs).length) deviceManifest.dacs = dacs;
  if (Object.keys(pwms).length) deviceManifest.pwms = pwms;
  if (Object.keys(serials).length) deviceManifest.serials = serials;

  return { deviceManifest, externalResources, deploymentMapping };
}
