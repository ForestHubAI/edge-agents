// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { describe, it, expect } from "vitest";
import { buildDeploymentSpec, assertDeployable, sidecarServiceName } from "./spec";
import { deriveRequirements } from "./requirements";
import type { DeploymentInputs } from "./inputs";
import { MAIN_CANVAS_ID, type Workflow } from "../workflow";
import type { Channel } from "../channel";
import type { Model } from "../model";
import type { Node } from "../node";
import type { DeploymentSchemas, EngineSchemas } from "../api";

type Spec = DeploymentSchemas["DeploymentSpec"];

// The engine is the component named "engine"; its config is transported as an
// opaque blob, so cast it back to EngineConfig to inspect manifest/mapping/etc.
function engineOf(spec: Spec): DeploymentSchemas["DeployComponent"] {
  const e = spec.components.find((c) => c.name === "engine");
  if (!e) throw new Error("expected engine component");
  return e;
}
function engineConfigOf(spec: Spec): EngineSchemas["EngineConfig"] {
  return engineOf(spec).config as EngineSchemas["EngineConfig"];
}
const llamaOf = (spec: Spec, modelId: string) => spec.components.find((c) => c.name === sidecarServiceName(modelId));

function channel(id: string, type: Channel["type"], args: Record<string, unknown> = {}): Channel {
  return { id, label: id, type, arguments: args };
}

// Minimal Agent node referencing a catalog `model` — only the model ref matters
// to the resolver's node-walk.
function agent(id: string, model: string): Node {
  return {
    id,
    type: "Agent",
    position: { x: 0, y: 0 },
    arguments: { name: id, model, instructions: "", outputDeclarations: [], memoryRefs: [], answer: { active: true, mode: "emit", name: "answer" } },
  } as Node;
}

const customModel: Model = { id: "local-llm", label: "Local", type: "LLMModel", arguments: {} };

// One workflow exercising every resource kind: a cdev output (GPIO), a serial
// device (cdev), a sysfs ADC (privileged), an MQTT channel, and an on-device
// custom model. Empty main canvas — the resolver reads channels/models, not nodes.
function fullWorkflow(): Workflow {
  return {
    canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
    functions: {},
    channels: {
      led: channel("led", "GPIOOUT"),
      serial0: channel("serial0", "UART"),
      sensor: channel("sensor", "ADC"),
      telemetry: channel("telemetry", "MQTT", { topic: "t/x" }),
    },
    memory: {},
    models: { "local-llm": customModel },
  };
}

const fullInputs: DeploymentInputs = {
  hardware: {
    led: { chipOrDevice: "/dev/gpiochip0", index: 17 },
    serial0: { chipOrDevice: "/dev/ttyUSB0", baud: 9600 },
    sensor: { chipOrDevice: "/sys/bus/iio/devices/iio:device0", index: 0 },
  },
  mqtt: { telemetry: { brokerUrl: "mqtt://broker.local:1883", username: "u", password: "p" } },
  models: { "local-llm": { location: "device", modelFile: "model.gguf" } },
};

const meta = {
  id: "dep-1",
  engineImage: "fh-engine:0.4.2",
  llamaServerImage: "ghcr.io/ggml-org/llama.cpp:server-b8589",
};

describe("buildDeploymentSpec", () => {
  it("resolves a full workflow into a contract-shaped spec", () => {
    const { spec } = buildDeploymentSpec(fullWorkflow(), fullInputs, meta);

    expect(spec.schemaVersion).toBe(1);
    expect(spec.id).toBe("dep-1");

    const engine = engineOf(spec);
    expect(engine.image).toBe("fh-engine:0.4.2");
    expect(engine.pull).toBe("never"); // built locally, in no registry
    expect(engineConfigOf(spec).workflow.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it("splits the device manifest by family and maps every resource", () => {
    const config = engineConfigOf(buildDeploymentSpec(fullWorkflow(), fullInputs, meta).spec);
    const m = config.manifest!;
    expect(Object.keys(m.gpios ?? {})).toHaveLength(1);
    expect(Object.keys(m.serials ?? {})).toHaveLength(1);
    expect(Object.keys(m.adcs ?? {})).toHaveLength(1);

    // Mapping keyed by every workflow logical id; each ref resolves to a built resource.
    expect(Object.keys(config.mapping ?? {}).sort()).toEqual(["led", "local-llm", "sensor", "serial0", "telemetry"]);
    expect(config.mapping!.sensor).toEqual({ ref: expect.any(String), index: 0 });
  });

  it("resolves cdev nodes into devices and forces privileged for sysfs families", () => {
    const engine = engineOf(buildDeploymentSpec(fullWorkflow(), fullInputs, meta).spec);
    // GPIO + serial are cdev → granted; ADC (sysfs) is not a node → privileged instead.
    expect(engine.devices?.sort()).toEqual(["/dev/gpiochip0", "/dev/ttyUSB0"]);
    expect(engine.privileged).toBe(true);
    // A nonroot image reaching root-owned nodes/sysfs runs as root.
    expect(engine.user).toBe("0:0");
  });

  it("emits a llama-server component and points the engine's provider at the sidecar", () => {
    const { spec } = buildDeploymentSpec(fullWorkflow(), fullInputs, meta);
    expect(llamaOf(spec, "local-llm")).toMatchObject({
      name: sidecarServiceName("local-llm"),
      image: "ghcr.io/ggml-org/llama.cpp:server-b8589",
      command: ["--model", "/var/lib/foresthub/workspace/model.gguf", "--host", "0.0.0.0", "--port", "8080", "--ctx-size", "4096"],
      volumes: ["./workspaces/llama-local-llm:/var/lib/foresthub/workspace:ro"],
    });
    // The external-resource provider URL must point at the sidecar service name.
    const ext = engineConfigOf(spec).externalResources!;
    const provider = Object.values(ext).find((r) => r.type === "selfhostedLlm");
    expect(provider).toMatchObject({ url: `http://${sidecarServiceName("local-llm")}:8080` });
  });

  it("omits privileged and the llama sidecar when neither applies", () => {
    const wf: Workflow = {
      canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
      functions: {},
      channels: { led: channel("led", "GPIOOUT") },
      memory: {},
      models: {},
    };
    const { spec } = buildDeploymentSpec(wf, { hardware: { led: { chipOrDevice: "/dev/gpiochip0", index: 1 } }, mqtt: {}, models: {} }, meta);
    const engine = engineOf(spec);
    expect(engine.privileged).toBeUndefined();
    expect(spec.components).toHaveLength(1); // engine only, no sidecar
    expect(engine.devices).toEqual(["/dev/gpiochip0"]);
  });

  it("uses a network model's own endpoint and runs no sidecar", () => {
    const wf: Workflow = {
      canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
      functions: {},
      channels: {},
      memory: {},
      models: { "local-llm": customModel },
    };
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      models: { "local-llm": { location: "network", url: "https://infer.example/v1", apiKey: "k" } },
    };
    const { spec, resourceSecrets } = buildDeploymentSpec(wf, inputs, meta);
    expect(spec.components).toHaveLength(1); // engine only, no sidecar
    // The provider config in the spec is secret-free; the apiKey is pulled out.
    const ext = engineConfigOf(spec).externalResources!;
    const [ref, provider] = Object.entries(ext).find(([, r]) => r.type === "selfhostedLlm")!;
    expect(provider).toEqual({ type: "selfhostedLlm", url: "https://infer.example/v1" });
    expect(resourceSecrets[ref]).toEqual("k");
  });

  it("shares one selfhosted provider across models on the same endpoint", () => {
    const wf: Workflow = {
      canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
      functions: {},
      channels: {},
      memory: {},
      models: { a: { id: "a", label: "A", type: "LLMModel", arguments: {} }, b: { id: "b", label: "B", type: "LLMModel", arguments: {} } },
    };
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      models: {
        a: { location: "network", url: "https://vllm.local/v1", apiKey: "k" },
        b: { location: "network", url: "https://vllm.local/v1", apiKey: "k" },
      },
    };
    const { spec } = buildDeploymentSpec(wf, inputs, meta);
    const config = engineConfigOf(spec);
    // One endpoint → one provider entry, both models mapped at the same ref.
    const entries = Object.entries(config.externalResources!).filter(([, r]) => r.type === "selfhostedLlm");
    expect(entries).toHaveLength(1);
    const ref = entries[0]![0];
    expect(config.mapping!.a).toEqual({ ref });
    expect(config.mapping!.b).toEqual({ ref });
  });

  it("pulls MQTT/endpoint secrets out of the spec, keyed by resource ref", () => {
    const { spec, resourceSecrets } = buildDeploymentSpec(fullWorkflow(), fullInputs, meta);
    const ext = engineConfigOf(spec).externalResources!;
    // The stored connection carries metadata but never the password.
    const [mqttRef, mqttConn] = Object.entries(ext).find(([, r]) => r.type === "mqtt")!;
    expect(mqttConn).not.toHaveProperty("password");
    expect(mqttConn).toMatchObject({ username: "u" });
    expect(resourceSecrets[mqttRef]).toEqual("p");
    // Whole spec serialized carries no secret value.
    expect(JSON.stringify(spec)).not.toContain('"p"');
  });
});

describe("buildDeploymentSpec catalog providers", () => {
  const catalog = [
    { id: "claude-opus-4-7", label: "Opus", capabilities: ["chat"] as const, provider: "anthropic" },
    { id: "claude-haiku-4-7", label: "Haiku", capabilities: ["chat"] as const, provider: "anthropic" },
  ];
  // Two Agents on one provider + one on another; catalog resolves both.
  const wf: Workflow = {
    canvases: { [MAIN_CANVAS_ID]: { nodes: [agent("a1", "claude-opus-4-7"), agent("a2", "claude-haiku-4-7")], edges: [], variables: {} } },
    functions: {},
    channels: {},
    memory: {},
    models: {},
  };

  it("emits one localLlm instance per provider (deduped), no model mapping, pulls the key out", () => {
    const inputs: DeploymentInputs = { hardware: {}, mqtt: {}, models: {}, providers: { anthropic: { routing: "local", apiKey: "sk-x" } } };
    const { spec, resourceSecrets } = buildDeploymentSpec(wf, inputs, meta, [], catalog);
    const config = engineConfigOf(spec);
    const ext = config.externalResources!;
    // Two Agents, same provider → a single provider instance.
    const entries = Object.entries(ext).filter(([, r]) => r.type === "localLlm");
    expect(entries).toHaveLength(1);
    const [ref, cfg] = entries[0]!;
    expect(cfg).toEqual({ type: "localLlm", provider: "anthropic" });
    // Catalog models are routed by llmproxy, not mapped — no mapping entries.
    expect(config.mapping?.["claude-opus-4-7"]).toBeUndefined();
    expect(config.mapping?.["claude-haiku-4-7"]).toBeUndefined();
    expect(resourceSecrets[ref]).toBe("sk-x");
    expect(JSON.stringify(spec)).not.toContain("sk-x");
  });

  it("backendLlm carries the provider, no key and no secret", () => {
    const inputs: DeploymentInputs = { hardware: {}, mqtt: {}, models: {}, providers: { anthropic: { routing: "backend" } } };
    const { spec, resourceSecrets } = buildDeploymentSpec(wf, inputs, meta, [], catalog);
    const ext = engineConfigOf(spec).externalResources!;
    expect(Object.values(ext)).toContainEqual({ type: "backendLlm", provider: "anthropic" });
    expect(Object.keys(resourceSecrets)).toHaveLength(0);
  });

  it("rejects an unbound provider and a local provider missing its key", () => {
    expect(() => buildDeploymentSpec(wf, { hardware: {}, mqtt: {}, models: {} }, meta, [], catalog)).toThrow(/provider "anthropic": routing/);
    const noKey: DeploymentInputs = { hardware: {}, mqtt: {}, models: {}, providers: { anthropic: { routing: "local" } } };
    expect(() => buildDeploymentSpec(wf, noKey, meta, [], catalog)).toThrow(/provider "anthropic": API key/);
  });

  it("refuses a referenced model absent from the catalog", () => {
    const stray: Workflow = { ...wf, canvases: { [MAIN_CANVAS_ID]: { nodes: [agent("a1", "gpt-5-mystery")], edges: [], variables: {} } } };
    expect(() => buildDeploymentSpec(stray, { hardware: {}, mqtt: {}, models: {} }, meta, [], catalog)).toThrow(/not in the model catalog/);
  });
});

describe("buildDeploymentSpec custom components", () => {
  const bareWf: Workflow = {
    canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
    functions: {},
    channels: {},
    memory: {},
    models: {},
  };
  const bareInputs: DeploymentInputs = { hardware: {}, mqtt: {}, models: {} };

  it("merges custom components after engine (and llama)", () => {
    const grafana = { name: "grafana", image: "grafana/grafana:11.3.0", ports: ["3000:3000"] };
    const { spec } = buildDeploymentSpec(bareWf, bareInputs, meta, [grafana]);
    expect(spec.components.map((c) => c.name)).toEqual(["engine", "grafana"]);
  });

  it("rejects a custom name colliding with the engine", () => {
    expect(() => buildDeploymentSpec(bareWf, bareInputs, meta, [{ name: "engine", image: "x" }])).toThrow(
      /duplicate component name "engine"/,
    );
  });

  it("rejects a custom name colliding with a generated llama sidecar", () => {
    const dup = { name: sidecarServiceName("local-llm"), image: "x" };
    expect(() => buildDeploymentSpec(fullWorkflow(), fullInputs, meta, [dup])).toThrow(/duplicate component name/);
  });

  it("allows the same image under different names", () => {
    const a = { name: "graf-a", image: "grafana/grafana:11.3.0" };
    const b = { name: "graf-b", image: "grafana/grafana:11.3.0" };
    const { spec } = buildDeploymentSpec(bareWf, bareInputs, meta, [a, b]);
    expect(spec.components.map((c) => c.name)).toEqual(["engine", "graf-a", "graf-b"]);
  });

  it("rejects two customs sharing a name", () => {
    const a = { name: "dash", image: "x" };
    const b = { name: "dash", image: "y" };
    expect(() => buildDeploymentSpec(bareWf, bareInputs, meta, [a, b])).toThrow(/duplicate component name "dash"/);
  });
});

describe("assertDeployable", () => {
  it("throws listing every unbound resource", () => {
    const req = deriveRequirements(fullWorkflow());
    expect(() => assertDeployable(req, { hardware: {}, mqtt: {}, models: {} })).toThrow(/device path[\s\S]*broker URL[\s\S]*model/);
  });

  it("rejects a non-GGUF on-device model file", () => {
    const req = deriveRequirements(fullWorkflow());
    const inputs = { ...fullInputs, models: { "local-llm": { location: "device" as const, modelFile: "model.bin" } } };
    expect(() => assertDeployable(req, inputs)).toThrow(/\.gguf/);
  });
});

describe("deriveRequirements", () => {
  it("classifies channels into hardware families and mqtt", () => {
    const req = deriveRequirements(fullWorkflow());
    expect(req.hardwareChannels.map((c) => c.family).sort()).toEqual(["adc", "gpio", "serial"]);
    expect(req.mqttChannels.map((c) => c.id)).toEqual(["telemetry"]);
    expect(req.customModels.map((c) => c.id)).toEqual(["local-llm"]);
    expect(req.hardwareChannels.find((c) => c.family === "serial")?.addressable).toBe(false);
  });
});
