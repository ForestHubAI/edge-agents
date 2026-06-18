import { describe, it, expect } from "vitest";
import { buildDeploymentSpec, assertDeployable, sidecarServiceName } from "./spec";
import { deriveRequirements } from "./requirements";
import type { DeploymentInputs } from "./inputs";
import { MAIN_CANVAS_ID, type Workflow } from "../workflow";
import type { Channel } from "../channel";
import type { Model } from "../model";

function channel(id: string, type: Channel["type"], args: Record<string, unknown> = {}): Channel {
  return { id, label: id, type, arguments: args };
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

const meta = { id: "dep-1", status: "active" as const, engineVersion: "0.4.2", llamaServerVersion: "server-b8589" };

describe("buildDeploymentSpec", () => {
  it("resolves a full workflow into a contract-shaped spec", () => {
    const spec = buildDeploymentSpec(fullWorkflow(), fullInputs, meta);

    expect(spec.schemaVersion).toBe(1);
    expect(spec.id).toBe("dep-1");
    expect(spec.status).toBe("active");

    const engine = spec.components.engine;
    if (!engine) throw new Error("expected engine component");
    expect(engine.version).toBe("0.4.2");
    expect(engine.config.workflow.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it("splits the device manifest by family and maps every resource", () => {
    const { config } = buildDeploymentSpec(fullWorkflow(), fullInputs, meta).components.engine!;
    const m = config.manifest!;
    expect(Object.keys(m.gpios ?? {})).toHaveLength(1);
    expect(Object.keys(m.serials ?? {})).toHaveLength(1);
    expect(Object.keys(m.adcs ?? {})).toHaveLength(1);

    // Mapping keyed by every workflow logical id; each ref resolves to a built resource.
    expect(Object.keys(config.mapping ?? {}).sort()).toEqual(["led", "local-llm", "sensor", "serial0", "telemetry"]);
    expect(config.mapping!.sensor).toEqual({ ref: expect.any(String), index: 0 });
  });

  it("resolves cdev nodes into deviceGrants and forces privileged for sysfs families", () => {
    const { deviceGrants, privileged } = buildDeploymentSpec(fullWorkflow(), fullInputs, meta).components.engine!;
    // GPIO + serial are cdev → granted; ADC (sysfs) is not a node → privileged instead.
    expect(deviceGrants?.sort()).toEqual(["/dev/gpiochip0", "/dev/ttyUSB0"]);
    expect(privileged).toBe(true);
  });

  it("emits a llama-server component and points the engine's provider at the sidecar", () => {
    const spec = buildDeploymentSpec(fullWorkflow(), fullInputs, meta);
    expect(spec.components.llamaServer).toEqual({
      version: "server-b8589",
      models: [{ id: "local-llm", modelFile: "model.gguf" }],
    });
    // The external-resource provider URL must point at the sidecar service name.
    const ext = spec.components.engine!.config.externalResources!;
    const provider = Object.values(ext).find((r) => r.type === "selfhosted");
    expect(provider).toMatchObject({ url: `http://${sidecarServiceName("local-llm")}:8080` });
  });

  it("omits privileged and llamaServer when neither applies", () => {
    const wf: Workflow = {
      canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
      functions: {},
      channels: { led: channel("led", "GPIOOUT") },
      memory: {},
      models: {},
    };
    const spec = buildDeploymentSpec(wf, { hardware: { led: { chipOrDevice: "/dev/gpiochip0", index: 1 } }, mqtt: {}, models: {} }, meta);
    expect(spec.components.engine!.privileged).toBeUndefined();
    expect(spec.components.llamaServer).toBeUndefined();
    expect(spec.components.engine!.deviceGrants).toEqual(["/dev/gpiochip0"]);
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
    const spec = buildDeploymentSpec(wf, inputs, meta);
    expect(spec.components.llamaServer).toBeUndefined();
    const ext = spec.components.engine!.config.externalResources!;
    expect(Object.values(ext)).toContainEqual({ type: "selfhosted", url: "https://infer.example/v1", apiKey: "k" });
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
