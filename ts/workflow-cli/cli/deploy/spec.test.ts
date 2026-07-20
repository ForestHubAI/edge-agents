// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { describe, it, expect } from "vitest";
import { buildDeploymentSpec, assertDeployable, llamaComponentServiceName, mlComponentServiceName, cameraComponentServiceName } from "./spec";
import type { DeploymentInputs } from "./inputs";
import { deriveRequirements } from "./requirements";
import { ENGINE_COMPONENT_NAME } from "@foresthubai/workflow-core/deploy";
import { MAIN_CANVAS_ID, type Workflow } from "@foresthubai/workflow-core/workflow";
import type { Channel } from "@foresthubai/workflow-core/channel";
import type { Model, ModelInfo } from "@foresthubai/workflow-core/model";
import type { Node } from "@foresthubai/workflow-core/node";
import type { DeploymentSchemas, EngineSchemas } from "./api";

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
const llamaOf = (spec: Spec) => spec.components.find((c) => c.name === llamaComponentServiceName());

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
  } as unknown as Node;
}

const customModel: Model = { id: "local-llm", label: "Local", type: "LLMModel", arguments: {} };
const mlModel = (id: string): Model => ({ id, label: id, type: "MLModel", arguments: {} });

// A workflow declaring only the given ML models (no channels/hardware).
function mlWorkflow(models: Record<string, Model>): Workflow {
  return {
    canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
    functions: {},
    channels: {},
    memory: {},
    models,
  };
}

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
  llmModels: { "local-llm": { location: "device", modelFile: "model.gguf" } },
  mlModels: {},
  cameras: {},
};

const meta = {
  id: "dep-1",
  engineImage: "engine:0.4.2",
  llamaServerImage: "ghcr.io/ggml-org/llama.cpp:server-b8589",
  mlComponentImage: "ml-inference:latest",
  cameraComponentImage: "camera:latest",
};

// A channels-only workflow for uniqueness tests.
function channelsWorkflow(channels: Record<string, Channel>): Workflow {
  return {
    canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
    functions: {},
    channels,
    memory: {},
    models: {},
  };
}
const noInputs: DeploymentInputs = { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {} };

describe("buildDeploymentSpec uniqueness (canonical bindingConflicts, post-ref)", () => {
  it("rejects two hardware channels on one chip and line", () => {
    const wf = channelsWorkflow({ btn: channel("btn", "GPIOIN"), led: channel("led", "GPIOOUT") });
    const inputs = {
      ...noInputs,
      hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 17 }, led: { chipOrDevice: "/dev/gpiochip0", index: 17 } },
    };
    expect(() => buildDeploymentSpec(wf, inputs, meta)).toThrow(/conflict: all bound to the same resource \(gpio:/);
  });

  it("allows two hardware channels on one chip with different lines", () => {
    const wf = channelsWorkflow({ btn: channel("btn", "GPIOIN"), led: channel("led", "GPIOOUT") });
    const inputs = {
      ...noInputs,
      hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 17 }, led: { chipOrDevice: "/dev/gpiochip0", index: 27 } },
    };
    expect(() => buildDeploymentSpec(wf, inputs, meta)).not.toThrow();
  });

  it("rejects two MQTT channels on one broker and topic (a check the pre-ref path never had)", () => {
    const wf = channelsWorkflow({ a: channel("a", "MQTT", { topic: "alarm" }), b: channel("b", "MQTT", { topic: "alarm" }) });
    const inputs = { ...noInputs, mqtt: { a: { brokerUrl: "mqtt://x:1883" }, b: { brokerUrl: "mqtt://x:1883" } } };
    expect(() => buildDeploymentSpec(wf, inputs, meta)).toThrow(/conflict: all bound to the same resource \(mqtt:/);
  });

  it("allows two MQTT channels on one broker with different topics", () => {
    const wf = channelsWorkflow({ a: channel("a", "MQTT", { topic: "alarm" }), b: channel("b", "MQTT", { topic: "telemetry" }) });
    const inputs = { ...noInputs, mqtt: { a: { brokerUrl: "mqtt://x:1883" }, b: { brokerUrl: "mqtt://x:1883" } } };
    expect(() => buildDeploymentSpec(wf, inputs, meta)).not.toThrow();
  });
});

describe("buildDeploymentSpec", () => {
  it("resolves a full workflow into a contract-shaped spec", () => {
    const { spec } = buildDeploymentSpec(fullWorkflow(), fullInputs, meta);

    expect(spec.schemaVersion).toBe(1);
    expect(spec.id).toBe("dep-1");

    const engine = engineOf(spec);
    expect(engine.image).toBe("engine:0.4.2");
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

  it("emits a shared llama-server component and points the engine's provider at it", () => {
    const { spec } = buildDeploymentSpec(fullWorkflow(), fullInputs, meta);
    const llama = llamaOf(spec)!;
    expect(llama).toMatchObject({
      name: llamaComponentServiceName(),
      image: "ghcr.io/ggml-org/llama.cpp:server-b8589",
      // The models list rides as the config blob (config.json); no per-model command.
      config: { models: [{ id: "local-llm", file: "model.gguf", args: ["--ctx-size", "4096"] }] },
      volumes: [`./workspaces/${llamaComponentServiceName()}:/var/lib/foresthub/workspace:ro`],
    });
    expect(llama.command).toBeUndefined();
    // The external-resource provider URL must point at the shared component service.
    const ext = engineConfigOf(spec).externalResources!;
    const provider = Object.values(ext).find((r) => r.type === "selfhostedLlm");
    expect(provider).toMatchObject({ url: `http://${llamaComponentServiceName()}:8080` });
  });

  it("emits ONE shared llama component for multiple device models and points each at it", () => {
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
      llmModels: {
        a: { location: "device", modelFile: "a.gguf" },
        b: { location: "device", modelFile: "b.gguf", ctxSize: 8192 },
      },
      mlModels: {},
      cameras: {},
    };
    const { spec } = buildDeploymentSpec(wf, inputs, meta);

    // Exactly one component for both models — not one per model.
    const llamas = spec.components.filter((c) => c.name === llamaComponentServiceName());
    expect(llamas).toHaveLength(1);
    expect(llamas[0]!.config).toEqual({
      models: [
        { id: "a", file: "a.gguf", args: ["--ctx-size", "4096"] },
        { id: "b", file: "b.gguf", args: ["--ctx-size", "8192"] },
      ],
    });
    // ONE provider for both models, not one per model: the ref identifies the endpoint
    // and the model sub-address picks the model within it.
    const ext = engineConfigOf(spec).externalResources!;
    const providers = Object.entries(ext).filter(([, r]) => r.type === "selfhostedLlm");
    expect(providers).toHaveLength(1);
    const [ref, provider] = providers[0]!;
    expect(provider).toMatchObject({ url: `http://${llamaComponentServiceName()}:8080` });
    expect(engineConfigOf(spec).mapping).toEqual({ a: { ref, model: "a" }, b: { ref, model: "b" } });
  });

  it("omits privileged and the llama component when neither applies", () => {
    const wf: Workflow = {
      canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
      functions: {},
      channels: { led: channel("led", "GPIOOUT") },
      memory: {},
      models: {},
    };
    const { spec } = buildDeploymentSpec(wf, { hardware: { led: { chipOrDevice: "/dev/gpiochip0", index: 1 } }, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {} }, meta);
    const engine = engineOf(spec);
    expect(engine.privileged).toBeUndefined();
    expect(spec.components).toHaveLength(1); // engine only, no component
    expect(engine.devices).toEqual(["/dev/gpiochip0"]);
  });

  it("uses a network model's own endpoint and runs no component", () => {
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
      llmModels: { "local-llm": { location: "network", url: "https://infer.example/v1", apiKey: "k" } },
      mlModels: {},
      cameras: {},
    };
    const { spec, componentSecrets } = buildDeploymentSpec(wf, inputs, meta);
    expect(spec.components).toHaveLength(1); // engine only, no component
    // The provider config in the spec is secret-free; the apiKey is pulled out.
    const ext = engineConfigOf(spec).externalResources!;
    const [ref, provider] = Object.entries(ext).find(([, r]) => r.type === "selfhostedLlm")!;
    expect(provider).toEqual({ type: "selfhostedLlm", url: "https://infer.example/v1" });
    expect(componentSecrets[ENGINE_COMPONENT_NAME]?.[ref]).toEqual("k");
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
      llmModels: {
        a: { location: "network", url: "https://vllm.local/v1", apiKey: "k" },
        b: { location: "network", url: "https://vllm.local/v1", apiKey: "k" },
      },
      mlModels: {},
      cameras: {},
    };
    const { spec } = buildDeploymentSpec(wf, inputs, meta);
    const config = engineConfigOf(spec);
    // One endpoint → one provider entry, both models mapped at the same ref,
    // each carrying its served model name (the workflow id, no alias input yet).
    const entries = Object.entries(config.externalResources!).filter(([, r]) => r.type === "selfhostedLlm");
    expect(entries).toHaveLength(1);
    const ref = entries[0]![0];
    expect(config.mapping!.a).toEqual({ ref, model: "a" });
    expect(config.mapping!.b).toEqual({ ref, model: "b" });
  });

  it("pulls MQTT/endpoint secrets out of the spec, keyed by resource ref", () => {
    const { spec, componentSecrets } = buildDeploymentSpec(fullWorkflow(), fullInputs, meta);
    const ext = engineConfigOf(spec).externalResources!;
    // The stored connection carries metadata but never the password.
    const [mqttRef, mqttConn] = Object.entries(ext).find(([, r]) => r.type === "mqtt")!;
    expect(mqttConn).not.toHaveProperty("password");
    expect(mqttConn).toMatchObject({ username: "u" });
    expect(componentSecrets[ENGINE_COMPONENT_NAME]?.[mqttRef]).toEqual("p");
    // Whole spec serialized carries no secret value.
    expect(JSON.stringify(spec)).not.toContain('"p"');
  });
});

describe("buildDeploymentSpec catalog providers", () => {
  const catalog: ModelInfo[] = [
    { id: "claude-opus-4-7", label: "Opus", capabilities: ["chat"], provider: "anthropic" },
    { id: "claude-haiku-4-7", label: "Haiku", capabilities: ["chat"], provider: "anthropic" },
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
    const inputs: DeploymentInputs = { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {}, providers: { anthropic: { routing: "local", apiKey: "sk-x" } } };
    const { spec, componentSecrets } = buildDeploymentSpec(wf, inputs, meta, [], catalog);
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
    expect(componentSecrets[ENGINE_COMPONENT_NAME]?.[ref]).toBe("sk-x");
    expect(JSON.stringify(spec)).not.toContain("sk-x");
  });

  it("backendLlm carries the provider, no key and no secret", () => {
    const inputs: DeploymentInputs = { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {}, providers: { anthropic: { routing: "backend" } } };
    const { spec, componentSecrets } = buildDeploymentSpec(wf, inputs, meta, [], catalog);
    const ext = engineConfigOf(spec).externalResources!;
    expect(Object.values(ext)).toContainEqual({ type: "backendLlm", provider: "anthropic" });
    expect(Object.keys(componentSecrets[ENGINE_COMPONENT_NAME] ?? {})).toHaveLength(0);
  });

  it("rejects an unbound provider and a local provider missing its key", () => {
    expect(() => buildDeploymentSpec(wf, { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {} }, meta, [], catalog)).toThrow(/provider "anthropic": routing/);
    const noKey: DeploymentInputs = { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {}, providers: { anthropic: { routing: "local" } } };
    expect(() => buildDeploymentSpec(wf, noKey, meta, [], catalog)).toThrow(/provider "anthropic": API key/);
  });

  it("refuses a referenced model absent from the catalog", () => {
    const stray: Workflow = { ...wf, canvases: { [MAIN_CANVAS_ID]: { nodes: [agent("a1", "gpt-5-mystery")], edges: [], variables: {} } } };
    expect(() => buildDeploymentSpec(stray, { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {} }, meta, [], catalog)).toThrow(/not in the model catalog/);
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
  const bareInputs: DeploymentInputs = { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {} };

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

  it("rejects a custom name colliding with a generated llama component", () => {
    const dup = { name: llamaComponentServiceName(), image: "x" };
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
    expect(() => assertDeployable(req, { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {} })).toThrow(/device path[\s\S]*broker URL[\s\S]*model/);
  });

  it("rejects a non-GGUF on-device model file", () => {
    const req = deriveRequirements(fullWorkflow());
    const inputs = { ...fullInputs, llmModels: { "local-llm": { location: "device" as const, modelFile: "model.bin" } } };
    expect(() => assertDeployable(req, inputs)).toThrow(/\.gguf/);
  });

  // A rag requirement is unsatisfiable, not unbound: no input can clear it. It
  // still rides the aggregated error rather than short-circuiting the collection,
  // so the operator sees it alongside every other gap.
  it("refuses a declared VectorDatabase — no input can bind it standalone", () => {
    const wf = fullWorkflow();
    wf.memory = { vdb1: { id: "vdb1", label: "Docs", type: "VectorDatabase", arguments: {} } };
    const req = deriveRequirements(wf);
    expect(() => assertDeployable(req, fullInputs)).toThrow(/memory "vdb1": retrieval \(RAG\) is not supported/);
  });
});

describe("buildDeploymentSpec ML inference component", () => {
  it("emits ONE shared inference component for on-device ML models and points each at it", () => {
    const wf = mlWorkflow({ detector: mlModel("detector"), classifier: mlModel("classifier") });
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: { detector: { location: "device", model: "yolov8n" }, classifier: { location: "device", model: "resnet50" } },
      cameras: {},
    };
    const { spec } = buildDeploymentSpec(wf, inputs, meta);

    // Exactly one component for both models — not one per model.
    const components = spec.components.filter((c) => c.name === mlComponentServiceName());
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
      image: "ml-inference:latest",
      pull: "never",
      volumes: [`./workspaces/${mlComponentServiceName()}:/var/lib/foresthub/workspace:ro`],
    });

    // ONE endpoint entry for both models, not one per model: the ref identifies the
    // component and each model is picked by its sub-address within it.
    const ext = engineConfigOf(spec).externalResources!;
    const mlEntries = Object.entries(ext).filter(([, r]) => r.type === "ml-inference");
    expect(mlEntries).toHaveLength(1);
    const [ref, conn] = mlEntries[0]!;
    expect(conn).toEqual({ type: "ml-inference", url: `http://${mlComponentServiceName()}:8082` });
    // Each model is mapped at that one ref, carrying its component model name.
    const mapping = engineConfigOf(spec).mapping!;
    expect(mapping.detector).toEqual({ ref, model: "yolov8n" });
    expect(mapping.classifier).toEqual({ ref, model: "resnet50" });

    // The boot config declares the bundles the component must load, keyed by
    // repository sub-folder name — authoritative, so the component loads exactly these.
    expect(components[0]!.config).toEqual({ models: { yolov8n: {}, resnet50: {} } });
  });

  it("carries per-model params into the boot config", () => {
    const wf = mlWorkflow({ detector: mlModel("detector") });
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: { detector: { location: "device", model: "yolov8n", params: { confThreshold: 0.5 } } },
      cameras: {},
    };
    const { spec } = buildDeploymentSpec(wf, inputs, meta);
    const component = spec.components.find((c) => c.name === mlComponentServiceName())!;
    expect(component.config).toEqual({ models: { yolov8n: { params: { confThreshold: 0.5 } } } });
  });

  it("rejects two workflow models claiming the same bundle", () => {
    const wf = mlWorkflow({ detector: mlModel("detector"), other: mlModel("other") });
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: { detector: { location: "device", model: "yolov8n" }, other: { location: "device", model: "yolov8n" } },
      cameras: {},
    };
    // A bundle is an exclusive claim like any other resource, so the boot config can
    // never be asked to declare one twice.
    expect(() => buildDeploymentSpec(wf, inputs, meta)).toThrow(/same resource/);
  });

  it("uses a network ML model's own endpoint and runs no component", () => {
    const wf = mlWorkflow({ detector: mlModel("detector") });
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: { detector: { location: "network", url: "http://onnx.remote:8000", model: "yolov8n" } },
      cameras: {},
    };
    const { spec } = buildDeploymentSpec(wf, inputs, meta);
    expect(spec.components).toHaveLength(1); // engine only, no component
    const cfg = engineConfigOf(spec);
    const mlRes = Object.values(cfg.externalResources!).find((r) => r.type === "ml-inference");
    // The endpoint config carries no model — the selector rides on the binding.
    expect(mlRes).toEqual({ type: "ml-inference", url: "http://onnx.remote:8000" });
    expect(cfg.mapping!.detector).toEqual({ ref: expect.any(String), model: "yolov8n" });
  });
});

describe("buildDeploymentSpec capture component", () => {
  const cameraWorkflow = (ids: string[]): Workflow => ({
    canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
    functions: {},
    channels: Object.fromEntries(ids.map((id) => [id, channel(id, "CAMERA")])),
    memory: {},
    models: {},
  });
  const camInputs = (cameras: DeploymentInputs["cameras"]): DeploymentInputs => ({
    hardware: {},
    mqtt: {},
    llmModels: {},
    mlModels: {},
    cameras,
  });
  const manifestCameras = (spec: Spec) => engineConfigOf(spec).manifest?.cameras ?? {};

  it("declares each camera in the device manifest, never as an external resource", () => {
    const inputs = camInputs({
      front: { kind: "v4l2", device: "/dev/video0" },
      rear: { kind: "v4l2", device: "/dev/video1" },
    });
    const { spec } = buildDeploymentSpec(cameraWorkflow(["front", "rear"]), inputs, meta);

    // A camera is device-owned hardware: it lives in the manifest, and nothing
    // in externalResources points at the driver component.
    expect(manifestCameras(spec)).toEqual({
      video0: { kind: "v4l2", device: "/dev/video0" },
      video1: { kind: "v4l2", device: "/dev/video1" },
    });
    expect(engineConfigOf(spec).externalResources ?? {}).toEqual({});

    // Each channel maps to its manifest key — never to its own logical id.
    expect(engineConfigOf(spec).mapping).toEqual({ front: { ref: "video0" }, rear: { ref: "video1" } });
  });

  it("emits ONE driver component for the whole camera set", () => {
    const inputs = camInputs({
      front: { kind: "v4l2", device: "/dev/video0" },
      rear: { kind: "v4l2", device: "/dev/video1" },
    });
    const { spec } = buildDeploymentSpec(cameraWorkflow(["front", "rear"]), inputs, meta);

    const components = spec.components.filter((c) => c.name === cameraComponentServiceName());
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
      image: "camera:latest",
      pull: "never",
      // Its boot config rides as the component's config blob, like every other
      // component's — so the renderer mounts it with no camera-specific code, and
      // there is no workspace mount at all.
      config: { cameras: { video0: { kind: "v4l2", device: "/dev/video0" }, video1: { kind: "v4l2", device: "/dev/video1" } } },
    });
    expect(components[0].volumes).toBeUndefined();
    expect(components[0].devices?.sort()).toEqual(["/dev/video0", "/dev/video1"]);
  });

  it("rejects two channels declaring the same camera", () => {
    // A camera takes no discriminator, so this is one requirement declared twice.
    // Two sizes from one camera is two CameraCapture nodes, not two channels. Two
    // v4l2 channels on one node also open one device, so device-exclusivity rejects
    // them first (in assertDeployable) before the ref-identity check runs.
    const inputs = camInputs({
      wide: { kind: "v4l2", device: "/dev/video0" },
      thumb: { kind: "v4l2", device: "/dev/video0" },
    });
    expect(() => buildDeploymentSpec(cameraWorkflow(["wide", "thumb"]), inputs, meta)).toThrow(/already opened by "wide"/);
  });

  it("rejects two channels declaring the same network camera (ref identity, no device)", () => {
    // rtsp opens no exclusive device, so device-exclusivity can't catch it — the
    // identical bindings dedup to one ref and bindingConflicts rejects the pair.
    const inputs = camInputs({
      wide: { kind: "rtsp", url: "rtsp://cam/stream" },
      thumb: { kind: "rtsp", url: "rtsp://cam/stream" },
    });
    expect(() => buildDeploymentSpec(cameraWorkflow(["wide", "thumb"]), inputs, meta)).toThrow(/conflict: all bound to the same resource/);
  });

  it("rejects two bindings on one device node that differ elsewhere", () => {
    // Distinct refs (warmupFrames is part of the content-addressed identity), so
    // the identity check passes — but one /dev/video0 is single-open, and two
    // pipelines on it race for EBUSY at capture time on a spec that looked valid.
    const inputs = camInputs({
      a: { kind: "v4l2", device: "/dev/video0", warmupFrames: 2 },
      b: { kind: "v4l2", device: "/dev/video0", warmupFrames: 5 },
    });
    expect(() => buildDeploymentSpec(cameraWorkflow(["a", "b"]), inputs, meta)).toThrow(/already opened by "a"/);
  });

  it("keeps cameras distinct when they differ only by credential", () => {
    const inputs = camInputs({
      a: { kind: "rtsp", url: "rtsp://cam/s1", password: "pw1" },
      b: { kind: "rtsp", url: "rtsp://cam/s1", password: "pw2" },
    });
    const { spec, componentSecrets } = buildDeploymentSpec(cameraWorkflow(["a", "b"]), inputs, meta);

    expect(Object.keys(manifestCameras(spec))).toHaveLength(2);
    expect(Object.keys(componentSecrets[cameraComponentServiceName()] ?? {})).toHaveLength(2);
  });

  it("puts a stream password in the DRIVER component's secret doc, not the engine's", () => {
    const inputs = camInputs({ gate: { kind: "rtsp", url: "rtsp://cam/s1", user: "admin", password: "hunter2" } });
    const { spec, componentSecrets } = buildDeploymentSpec(cameraWorkflow(["gate"]), inputs, meta);

    const ref = Object.keys(manifestCameras(spec))[0]!;
    // Keyed by the camera's own ref — there is no secretRef to resolve.
    expect(componentSecrets[cameraComponentServiceName()]).toEqual({ [ref]: "hunter2" });
    // The engine never sees it: it never builds the capture pipeline.
    expect(componentSecrets[ENGINE_COMPONENT_NAME]?.[ref]).toBeUndefined();
    // And it is nowhere in the spec.
    expect(JSON.stringify(spec)).not.toContain("hunter2");
  });

  it("keeps an rtsp camera on-device: a manifest entry, no operator endpoint", () => {
    const inputs = camInputs({ front: { kind: "rtsp", url: "rtsp://cam.remote/s1" } });
    const { spec } = buildDeploymentSpec(cameraWorkflow(["front"]), inputs, meta);

    // An IP camera is still read by the local driver component — it is reached
    // over the network, not deployed over it.
    expect(spec.components.filter((c) => c.name === cameraComponentServiceName())).toHaveLength(1);
    expect(manifestCameras(spec)).toEqual({ "cam-cam.remote": { kind: "rtsp", url: "rtsp://cam.remote/s1" } });
  });

  it("passes through v4l2 nodes deduped; libcamera grants no device but needs udev", () => {
    const inputs = camInputs({
      // Two distinct cameras whose setup touches one shared media node — granted once.
      a: { kind: "v4l2", device: "/dev/video0", devices: ["/dev/media0"] },
      b: { kind: "v4l2", device: "/dev/video1", devices: ["/dev/media0"] },
      csi: { kind: "libcamera" }, // no /dev node
    });
    const { spec } = buildDeploymentSpec(cameraWorkflow(["a", "b", "csi"]), inputs, meta);
    const component = spec.components.find((c) => c.name === cameraComponentServiceName())!;
    expect(component.devices).toEqual(["/dev/video0", "/dev/media0", "/dev/video1"]);
    // libcamera discovers cameras through the host's udev database.
    expect(component.volumes).toContain("/run/udev:/run/udev:ro");
  });

  it("passes through the extra device nodes a binding's setup commands touch", () => {
    const inputs = camInputs({
      cam: {
        kind: "v4l2",
        device: "/dev/video1",
        setup: ["media-ctl -d /dev/media2 -r"],
        devices: ["/dev/media2", "/dev/v4l-subdev7"],
      },
    });
    const { spec } = buildDeploymentSpec(cameraWorkflow(["cam"]), inputs, meta);
    const component = spec.components.find((c) => c.name === cameraComponentServiceName())!;
    expect(component.devices).toEqual(["/dev/video1", "/dev/media2", "/dev/v4l-subdev7"]);
    // devices is render-only — it never reaches the manifest entry.
    expect(manifestCameras(spec)["video1"]).toEqual({ kind: "v4l2", device: "/dev/video1", setup: ["media-ctl -d /dev/media2 -r"] });
  });

  it("rejects an unbound camera", () => {
    const req = deriveRequirements(cameraWorkflow(["front"]));
    expect(() => assertDeployable(req, camInputs({}))).toThrow(/camera "front"/);
  });
});
