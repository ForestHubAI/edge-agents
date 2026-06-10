import { describe, it, expect } from "vitest";
import { assertDeployable, buildDeployArtifacts, sidecarServiceName } from "./builders";
import type { DeployConfig, DeployRequirements, HardwareChannel, HardwareFamily } from "./types";

// Factories: a full requirements/config object with defaults; each test
// overrides only what it exercises.
function reqOf(p: Partial<DeployRequirements> = {}): DeployRequirements {
  return {
    hasProviderModel: false,
    hasRetriever: false,
    hasWebSearch: false,
    hardwareChannels: [],
    mqttChannels: [],
    customModels: [],
    ...p,
  };
}

function cfgOf(p: Partial<DeployConfig> = {}): DeployConfig {
  return { llmKeys: {}, outputDir: "out", force: false, logLevel: "info", hardware: {}, mqtt: {}, models: {}, ...p };
}

const hw = (id: string, family: HardwareFamily): HardwareChannel => ({
  id,
  label: id,
  family,
  addressable: family !== "serial",
});

describe("assertDeployable", () => {
  it("throws when a hardware device path is missing", () => {
    expect(() => assertDeployable(reqOf({ hardwareChannels: [hw("btn", "gpio")] }), cfgOf())).toThrow(/btn/);
  });

  it("throws when an addressable channel has no index", () => {
    const req = reqOf({ hardwareChannels: [hw("btn", "gpio")] });
    expect(() => assertDeployable(req, cfgOf({ hardware: { btn: { chipOrDevice: "/dev/gpiochip0" } } }))).toThrow(
      /index/,
    );
  });

  it("does not require an index for serial (non-addressable)", () => {
    const req = reqOf({ hardwareChannels: [hw("u", "serial")] });
    expect(() => assertDeployable(req, cfgOf({ hardware: { u: { chipOrDevice: "/dev/ttyUSB0" } } }))).not.toThrow();
  });

  it("throws when a binding targets a channel the workflow doesn't declare", () => {
    const req = reqOf({ hardwareChannels: [hw("btn", "gpio")] });
    const cfg = cfgOf({
      hardware: {
        btn: { chipOrDevice: "/dev/gpiochip0", index: 17 },
        bttn: { chipOrDevice: "/dev/gpiochip0", index: 18 },
      },
    });
    expect(() => assertDeployable(req, cfg)).toThrow(/bttn.*no such channel/);
  });

  it("throws when a serial channel carries an index", () => {
    const req = reqOf({ hardwareChannels: [hw("u", "serial")] });
    expect(() => assertDeployable(req, cfgOf({ hardware: { u: { chipOrDevice: "/dev/ttyUSB0", index: 0 } } }))).toThrow(
      /index/,
    );
  });

  it("collects every gap into one message", () => {
    const req = reqOf({
      mqttChannels: [{ id: "m", label: "m" }],
      customModels: [{ id: "llm", label: "llm" }],
    });
    let msg = "";
    try {
      assertDeployable(req, cfgOf());
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/m/);
    expect(msg).toMatch(/llm/);
  });

  it("throws when a device model has no filename", () => {
    const req = reqOf({ customModels: [{ id: "llm", label: "llm" }] });
    expect(() => assertDeployable(req, cfgOf({ models: { llm: { location: "device", modelFile: "" } } }))).toThrow(/llm/);
  });

  it("throws when a device model's filename is not a plain .gguf name", () => {
    const req = reqOf({ customModels: [{ id: "llm", label: "llm" }] });
    expect(() => assertDeployable(req, cfgOf({ models: { llm: { location: "device", modelFile: "model.bin" } } }))).toThrow(/\.gguf/);
    expect(() => assertDeployable(req, cfgOf({ models: { llm: { location: "device", modelFile: "sub/model.gguf" } } }))).toThrow(
      /filename, not a path/,
    );
  });

  it("throws when a network model has no url", () => {
    const req = reqOf({ customModels: [{ id: "llm", label: "llm" }] });
    expect(() => assertDeployable(req, cfgOf({ models: { llm: { location: "network", url: "" } } }))).toThrow(/llm/);
  });

  it("throws when two channels claim the same chip and line", () => {
    const req = reqOf({ hardwareChannels: [hw("btn", "gpio"), hw("led", "gpio")] });
    const cfg = cfgOf({
      hardware: {
        btn: { chipOrDevice: "/dev/gpiochip0", index: 17 },
        led: { chipOrDevice: "/dev/gpiochip0", index: 17 },
      },
    });
    expect(() => assertDeployable(req, cfg)).toThrow(/already used by "btn"/);
  });

  it("accepts two channels sharing a chip on different lines", () => {
    const req = reqOf({ hardwareChannels: [hw("btn", "gpio"), hw("led", "gpio")] });
    const cfg = cfgOf({
      hardware: {
        btn: { chipOrDevice: "/dev/gpiochip0", index: 17 },
        led: { chipOrDevice: "/dev/gpiochip0", index: 27 },
      },
    });
    expect(() => assertDeployable(req, cfg)).not.toThrow();
  });

  it("throws when two serial channels claim the same device", () => {
    const req = reqOf({ hardwareChannels: [hw("u1", "serial"), hw("u2", "serial")] });
    const cfg = cfgOf({
      hardware: {
        u1: { chipOrDevice: "/dev/ttyUSB0", baud: 9600 },
        u2: { chipOrDevice: "/dev/ttyUSB0", baud: 115200 },
      },
    });
    expect(() => assertDeployable(req, cfg)).toThrow(/already used by "u1"/);
  });
});

describe("buildDeployArtifacts — hardware", () => {
  it("maps gpio to chip + an indexed mapping", () => {
    const req = reqOf({ hardwareChannels: [hw("btn", "gpio")] });
    const cfg = cfgOf({ hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 17 } } });
    const { deviceManifest, deploymentMapping } = buildDeployArtifacts(req, cfg);
    expect(deviceManifest.gpios).toEqual({ gpiochip0: { chip: "/dev/gpiochip0" } });
    expect(deploymentMapping.btn).toEqual({ ref: "gpiochip0", index: 17 });
  });

  it("uses device for adc/dac and chip for pwm", () => {
    const req = reqOf({ hardwareChannels: [hw("a", "adc"), hw("d", "dac"), hw("p", "pwm")] });
    const cfg = cfgOf({
      hardware: {
        a: { chipOrDevice: "/sys/bus/iio/devices/iio:device0", index: 0 },
        d: { chipOrDevice: "/sys/bus/iio/devices/iio:device1", index: 1 },
        p: { chipOrDevice: "/sys/class/pwm/pwmchip0", index: 2 },
      },
    });
    const { deviceManifest } = buildDeployArtifacts(req, cfg);
    expect(deviceManifest.adcs).toEqual({ "iio:device0": { device: "/sys/bus/iio/devices/iio:device0" } });
    expect(deviceManifest.dacs).toEqual({ "iio:device1": { device: "/sys/bus/iio/devices/iio:device1" } });
    expect(deviceManifest.pwms).toEqual({ pwmchip0: { chip: "/sys/class/pwm/pwmchip0" } });
  });

  it("serial carries device+baud and an index-less mapping", () => {
    const req = reqOf({ hardwareChannels: [hw("u", "serial")] });
    const cfg = cfgOf({ hardware: { u: { chipOrDevice: "/dev/ttyUSB0", baud: 9600 } } });
    const { deviceManifest, deploymentMapping } = buildDeployArtifacts(req, cfg);
    expect(deviceManifest.serials).toEqual({ ttyUSB0: { device: "/dev/ttyUSB0", baud: 9600 } });
    expect(deploymentMapping.u).toEqual({ ref: "ttyUSB0" });
  });

  it("omits baud when not set", () => {
    const req = reqOf({ hardwareChannels: [hw("u", "serial")] });
    const cfg = cfgOf({ hardware: { u: { chipOrDevice: "/dev/ttyUSB0" } } });
    expect(buildDeployArtifacts(req, cfg).deviceManifest.serials).toEqual({ ttyUSB0: { device: "/dev/ttyUSB0" } });
  });

  it("dedups two channels on the same chip into one driver, two mappings", () => {
    const req = reqOf({ hardwareChannels: [hw("a", "gpio"), hw("b", "gpio")] });
    const cfg = cfgOf({
      hardware: { a: { chipOrDevice: "/dev/gpiochip0", index: 1 }, b: { chipOrDevice: "/dev/gpiochip0", index: 2 } },
    });
    const { deviceManifest, deploymentMapping } = buildDeployArtifacts(req, cfg);
    expect(deviceManifest.gpios).toEqual({ gpiochip0: { chip: "/dev/gpiochip0" } });
    expect(deploymentMapping.a).toEqual({ ref: "gpiochip0", index: 1 });
    expect(deploymentMapping.b).toEqual({ ref: "gpiochip0", index: 2 });
  });

  it("disambiguates distinct paths that share a basename", () => {
    const req = reqOf({ hardwareChannels: [hw("a", "gpio"), hw("b", "gpio")] });
    const cfg = cfgOf({
      hardware: { a: { chipOrDevice: "/dev/gpiochip0", index: 1 }, b: { chipOrDevice: "/dev/bus/gpiochip0", index: 2 } },
    });
    expect(buildDeployArtifacts(req, cfg).deviceManifest.gpios).toEqual({
      gpiochip0: { chip: "/dev/gpiochip0" },
      "gpiochip0-2": { chip: "/dev/bus/gpiochip0" },
    });
  });

  it("omits manifest slots that have no entries", () => {
    const req = reqOf({ hardwareChannels: [hw("btn", "gpio")] });
    const cfg = cfgOf({ hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 0 } } });
    const { deviceManifest } = buildDeployArtifacts(req, cfg);
    expect(deviceManifest.adcs).toBeUndefined();
    expect(deviceManifest.serials).toBeUndefined();
  });
});

describe("buildDeployArtifacts — mqtt", () => {
  const ch = (id: string) => ({ id, label: id });

  it("emits an mqtt connection and an index-less mapping", () => {
    const req = reqOf({ mqttChannels: [ch("m")] });
    const cfg = cfgOf({ mqtt: { m: { brokerUrl: "tcp://b:1883", username: "u", password: "p" } } });
    const { externalResources, deploymentMapping } = buildDeployArtifacts(req, cfg);
    expect(deploymentMapping.m).toEqual({ ref: "mqtt-b" });
    expect(externalResources["mqtt-b"]).toEqual({ type: "mqtt", brokerUrl: "tcp://b:1883", username: "u", password: "p" });
  });

  it("attaches optional fields only when set", () => {
    const req = reqOf({ mqttChannels: [ch("m")] });
    const cfg = cfgOf({ mqtt: { m: { brokerUrl: "tcp://b:1883" } } });
    expect(buildDeployArtifacts(req, cfg).externalResources["mqtt-b"]).toEqual({ type: "mqtt", brokerUrl: "tcp://b:1883" });
  });

  it("dedups identical connections and splits differing ones", () => {
    const req = reqOf({ mqttChannels: [ch("a"), ch("b"), ch("c")] });
    const cfg = cfgOf({
      mqtt: {
        a: { brokerUrl: "tcp://b:1883", username: "u" },
        b: { brokerUrl: "tcp://b:1883", username: "u" },
        c: { brokerUrl: "tcp://b:1883" },
      },
    });
    const { externalResources, deploymentMapping } = buildDeployArtifacts(req, cfg);
    expect(deploymentMapping.a).toEqual({ ref: "mqtt-b" });
    expect(deploymentMapping.b).toEqual({ ref: "mqtt-b" });
    expect(deploymentMapping.c).toEqual({ ref: "mqtt-b-2" });
    expect(Object.keys(externalResources).sort()).toEqual(["mqtt-b", "mqtt-b-2"]);
  });
});

describe("buildDeployArtifacts — models", () => {
  it("maps a network model to a selfhosted provider with the typed url + key", () => {
    const req = reqOf({ customModels: [{ id: "llm", label: "llm" }] });
    const cfg = cfgOf({ models: { llm: { location: "network", url: "http://localhost:8080", apiKey: "k" } } });
    const { externalResources, deploymentMapping } = buildDeployArtifacts(req, cfg);
    expect(deploymentMapping.llm).toEqual({ ref: "llm" });
    expect(externalResources.llm).toEqual({ type: "selfhosted", url: "http://localhost:8080", apiKey: "k" });
  });

  it("omits the key when a network model has none", () => {
    const req = reqOf({ customModels: [{ id: "llm", label: "llm" }] });
    const cfg = cfgOf({ models: { llm: { location: "network", url: "http://localhost:8080" } } });
    expect(buildDeployArtifacts(req, cfg).externalResources.llm).toEqual({ type: "selfhosted", url: "http://localhost:8080" });
  });

  it("derives the sidecar url for a device model and drops any key", () => {
    const req = reqOf({ customModels: [{ id: "gemma-3", label: "gemma" }] });
    const cfg = cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } });
    const { externalResources, deploymentMapping } = buildDeployArtifacts(req, cfg);
    const expectedUrl = `http://${sidecarServiceName("gemma-3")}:8080`;
    expect(deploymentMapping["gemma-3"]).toEqual({ ref: "gemma-3" });
    expect(externalResources["gemma-3"]).toEqual({ type: "selfhosted", url: expectedUrl });
    // url-to-service invariant: the derived url uses exactly the service name.
    expect(expectedUrl).toBe("http://llama-gemma-3:8080");
  });
});

describe("buildDeployArtifacts — empty", () => {
  it("returns three empty objects for a bare workflow", () => {
    const { deviceManifest, externalResources, deploymentMapping } = buildDeployArtifacts(reqOf(), cfgOf());
    expect(deviceManifest).toEqual({});
    expect(externalResources).toEqual({});
    expect(deploymentMapping).toEqual({});
  });
});
