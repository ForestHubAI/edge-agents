// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { describe, it, expect } from "vitest";
import { buildDeploymentSpec, assertDeployable, llamaComponentServiceName, mlComponentServiceName, cameraComponentServiceName } from "./spec";
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
  } as Node;
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
    // Every device model points at the same shared component url; each mapped by id.
    const ext = engineConfigOf(spec).externalResources!;
    const urls = Object.values(ext)
      .filter((r) => r.type === "selfhostedLlm")
      .map((r) => (r as { url: string }).url);
    expect(urls).toEqual([`http://${llamaComponentServiceName()}:8080`, `http://${llamaComponentServiceName()}:8080`]);
    expect(Object.keys(engineConfigOf(spec).mapping ?? {}).sort()).toEqual(["a", "b"]);
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
    const { spec, resourceSecrets } = buildDeploymentSpec(wf, inputs, meta);
    expect(spec.components).toHaveLength(1); // engine only, no component
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
      llmModels: {
        a: { location: "network", url: "https://vllm.local/v1", apiKey: "k" },
        b: { location: "network", url: "https://vllm.local/v1", apiKey: "k" },
      },
      mlModels: {},
      cameras: {},
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
    const inputs: DeploymentInputs = { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {}, providers: { anthropic: { routing: "local", apiKey: "sk-x" } } };
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
    const inputs: DeploymentInputs = { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {}, providers: { anthropic: { routing: "backend" } } };
    const { spec, resourceSecrets } = buildDeploymentSpec(wf, inputs, meta, [], catalog);
    const ext = engineConfigOf(spec).externalResources!;
    expect(Object.values(ext)).toContainEqual({ type: "backendLlm", provider: "anthropic" });
    expect(Object.keys(resourceSecrets)).toHaveLength(0);
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
});

describe("deriveRequirements", () => {
  it("classifies channels into hardware families and mqtt", () => {
    const req = deriveRequirements(fullWorkflow());
    expect(req.hardwareChannels.map((c) => c.family).sort()).toEqual(["adc", "gpio", "serial"]);
    expect(req.mqttChannels.map((c) => c.id)).toEqual(["telemetry"]);
    expect(req.customLLMModels.map((c) => c.id)).toEqual(["local-llm"]);
    expect(req.hardwareChannels.find((c) => c.family === "serial")?.addressable).toBe(false);
  });

  it("classifies declared models into the LLM and ML pools", () => {
    const req = deriveRequirements(mlWorkflow({ "local-llm": customModel, detector: mlModel("detector") }));
    expect(req.customLLMModels.map((m) => m.id)).toEqual(["local-llm"]);
    expect(req.customMLModels.map((m) => m.id)).toEqual(["detector"]);
  });

  it("classifies camera channels into the camera pool", () => {
    const wf: Workflow = {
      canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
      functions: {},
      channels: { front: channel("front", "CAMERA"), rear: channel("rear", "CAMERA") },
      memory: {},
      models: {},
    };
    const req = deriveRequirements(wf);
    expect(req.cameraChannels.map((c) => c.id).sort()).toEqual(["front", "rear"]);
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

    // Every on-device model resolves to the same component url; each is mapped by id.
    const ext = engineConfigOf(spec).externalResources!;
    const mlUrls = Object.values(ext)
      .filter((r) => r.type === "ml-inference")
      .map((r) => (r as { url: string }).url);
    expect(mlUrls).toEqual([`http://${mlComponentServiceName()}:8000`, `http://${mlComponentServiceName()}:8000`]);
    expect(Object.keys(engineConfigOf(spec).mapping ?? {}).sort()).toEqual(["classifier", "detector"]);
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
    const ext = engineConfigOf(spec).externalResources!;
    const mlRes = Object.values(ext).find((r) => r.type === "ml-inference");
    expect(mlRes).toEqual({ type: "ml-inference", url: "http://onnx.remote:8000", model: "yolov8n" });
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
  const camUrls = (spec: Spec): string[] =>
    Object.values(engineConfigOf(spec).externalResources ?? {})
      .filter((r) => r.type === "camera")
      .map((r) => (r as { url: string }).url);

  it("emits ONE shared capture component for on-device cameras and points each at it", () => {
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: {},
      cameras: {
        front: { location: "device", source: "v4l2", device: "/dev/video0" },
        rear: { location: "device", source: "v4l2", device: "/dev/video1" },
      },
    };
    const { spec } = buildDeploymentSpec(cameraWorkflow(["front", "rear"]), inputs, meta);

    // Exactly one component for both cameras — not one per camera.
    const components = spec.components.filter((c) => c.name === cameraComponentServiceName());
    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
      image: "camera:latest",
      pull: "never",
      volumes: [`./workspaces/${cameraComponentServiceName()}/cameras.json:/etc/foresthub/config.json:ro`],
    });
    // Both v4l2 nodes are passed through to the component.
    expect(components[0].devices?.sort()).toEqual(["/dev/video0", "/dev/video1"]);

    // Every on-device camera resolves to the same component url; each is mapped by id.
    expect(camUrls(spec)).toEqual([`http://${cameraComponentServiceName()}:8100`, `http://${cameraComponentServiceName()}:8100`]);
    expect(Object.keys(engineConfigOf(spec).mapping ?? {}).sort()).toEqual(["front", "rear"]);
  });

  it("uses a network camera's own endpoint and runs no component", () => {
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: {},
      cameras: { front: { location: "network", url: "http://cam.remote:8100" } },
    };
    const { spec } = buildDeploymentSpec(cameraWorkflow(["front"]), inputs, meta);
    expect(spec.components).toHaveLength(1); // engine only, no component
    expect(camUrls(spec)).toEqual(["http://cam.remote:8100"]);
  });

  it("mixes device + network cameras: the component serves only the device ones", () => {
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: {},
      cameras: {
        front: { location: "device", source: "v4l2", device: "/dev/video0" },
        remote: { location: "network", url: "http://cam.remote:8100" },
      },
    };
    const { spec } = buildDeploymentSpec(cameraWorkflow(["front", "remote"]), inputs, meta);
    expect(spec.components.filter((c) => c.name === cameraComponentServiceName())).toHaveLength(1);
    expect(camUrls(spec).sort()).toEqual(["http://cam.remote:8100", `http://${cameraComponentServiceName()}:8100`]);
  });

  it("passes through v4l2 nodes deduped; a gstreamer source grants no device", () => {
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: {},
      cameras: {
        a: { location: "device", source: "v4l2", device: "/dev/video0" },
        b: { location: "device", source: "v4l2", device: "/dev/video0" }, // same node → deduped
        csi: { location: "device", source: "gstreamer", device: "libcamerasrc" }, // no /dev node
      },
    };
    const { spec } = buildDeploymentSpec(cameraWorkflow(["a", "b", "csi"]), inputs, meta);
    const component = spec.components.find((c) => c.name === cameraComponentServiceName())!;
    expect(component.devices).toEqual(["/dev/video0"]);
    // A gstreamer camera means libcamera, which needs the host's udev database.
    expect(component.volumes).toContain("/run/udev:/run/udev:ro");
  });

  it("passes through the extra device nodes a binding's setup commands touch", () => {
    const inputs: DeploymentInputs = {
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: {},
      cameras: {
        cam: {
          location: "device",
          source: "v4l2",
          device: "/dev/video1",
          setup: ["media-ctl -d /dev/media2 -r"],
          devices: ["/dev/media2", "/dev/v4l-subdev7"],
        },
      },
    };
    const { spec } = buildDeploymentSpec(cameraWorkflow(["cam"]), inputs, meta);
    const component = spec.components.find((c) => c.name === cameraComponentServiceName())!;
    expect(component.devices).toEqual(["/dev/video1", "/dev/media2", "/dev/v4l-subdev7"]);
  });

  it("rejects an unbound camera", () => {
    const req = deriveRequirements(cameraWorkflow(["front"]));
    expect(() => assertDeployable(req, { hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {} })).toThrow(/camera "front"/);
  });
});
