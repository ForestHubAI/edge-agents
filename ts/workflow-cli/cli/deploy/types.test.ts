// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { familyMismatches, ggufNameError, unknownIds, valuesFileSchema } from "./types";
import type { DeployRequirements, BoundRequirement, NonCameraHardware, HardwareFamily } from "./types";

describe("ggufNameError", () => {
  it("accepts a plain .gguf filename, trimmed and case-insensitive", () => {
    expect(ggufNameError("model.gguf")).toBeNull();
    expect(ggufNameError("  Model.GGUF  ")).toBeNull();
  });

  it("rejects an empty or missing name", () => {
    expect(ggufNameError("")).toMatch(/required/);
    expect(ggufNameError("   ")).toMatch(/required/);
    expect(ggufNameError(undefined)).toMatch(/required/);
  });

  it("rejects a non-.gguf extension", () => {
    expect(ggufNameError("asdasds")).toMatch(/\.gguf/);
    expect(ggufNameError("model.bin")).toMatch(/\.gguf/);
  });

  it("rejects a path — only a bare filename belongs in the workspace dir", () => {
    expect(ggufNameError("sub/model.gguf")).toMatch(/path/);
  });
});

const hw = (id: string, family: Exclude<HardwareFamily, "camera">): NonCameraHardware => ({
  kind: "hardware",
  family,
  ref: null,
  index: null,
  id,
  label: id,
});

describe("familyMismatches", () => {
  it("flags a baud on a non-serial channel, naming channel and family", () => {
    const m = familyMismatches([hw("btn", "gpio")], {
      btn: { chipOrDevice: "/dev/gpiochip0", index: 17, baud: 9600 },
    });
    expect(m.join()).toMatch(/btn.*baud.*gpio/);
  });

  it("flags an index on a serial channel", () => {
    const m = familyMismatches([hw("u", "serial")], {
      u: { chipOrDevice: "/dev/ttyUSB0", index: 0 },
    });
    expect(m.join()).toMatch(/u.*index.*serial/);
  });

  it("accepts the fields where they belong", () => {
    const m = familyMismatches([hw("u", "serial"), hw("btn", "gpio")], {
      u: { chipOrDevice: "/dev/ttyUSB0", baud: 9600 },
      btn: { chipOrDevice: "/dev/gpiochip0", index: 17 },
    });
    expect(m).toEqual([]);
  });

  it("skips channels without a binding — completeness is a separate check", () => {
    expect(familyMismatches([hw("btn", "gpio")], {})).toEqual([]);
  });
});

interface ReqParts {
  hardwareChannels?: { id: string; label: string; family: HardwareFamily }[];
  mqttChannels?: { id: string; label: string }[];
  cameraChannels?: { id: string; label: string }[];
  customLLMModels?: { id: string; label: string }[];
  customMLModels?: { id: string; label: string }[];
  ragMemories?: { id: string; label: string }[];
  catalogProviders?: { id: string }[];
}
const reqOf = (p: ReqParts = {}): DeployRequirements => {
  const bindings: Record<string, BoundRequirement> = {};
  for (const h of p.hardwareChannels ?? []) bindings[h.id] = { kind: "hardware", family: h.family, ref: null, index: null, id: h.id, label: h.label };
  for (const c of p.cameraChannels ?? []) bindings[c.id] = { kind: "hardware", family: "camera", ref: null, index: null, id: c.id, label: c.label };
  for (const m of p.mqttChannels ?? []) bindings[m.id] = { kind: "mqtt", ref: null, topic: "", id: m.id, label: m.label };
  for (const m of p.customLLMModels ?? []) bindings[m.id] = { kind: "declaredLlm", model: null, id: m.id, label: m.label };
  for (const m of p.customMLModels ?? []) bindings[m.id] = { kind: "ml", ref: null, model: null, id: m.id, label: m.label };
  for (const r of p.ragMemories ?? []) bindings[r.id] = { kind: "rag", ref: null, id: r.id, label: r.label };
  return {
    bindings,
    hasProviderModel: false,
    catalogProviders: p.catalogProviders ?? [],
    unresolvedCatalogModels: [],
    hasWebSearch: false,
  };
};

describe("unknownIds", () => {
  it("flags a hardware id the workflow doesn't declare", () => {
    const m = unknownIds(reqOf({ hardwareChannels: [hw("led-out", "gpio")] }), {
      hardware: {
        "led-out": { chipOrDevice: "/dev/gpiochip0", index: 27 },
        "led-out1": { chipOrDevice: "/dev/gpiochip0", index: 1 },
      },
    });
    expect(m.join()).toMatch(/led-out1.*no such channel/);
    expect(m).toHaveLength(1);
  });

  it("flags unknown mqtt, model and camera ids with the right noun", () => {
    const m = unknownIds(reqOf(), {
      mqtt: { ghost: { brokerUrl: "tcp://x:1883" } },
      llmModels: { phantom: { location: "device", modelFile: "x.gguf" } },
      cameras: { ghostcam: { kind: "rtsp", url: "rtsp://x/s1" } },
    });
    expect(m.join()).toMatch(/mqtt "ghost".*no such channel/);
    expect(m.join()).toMatch(/model "phantom".*no such model/);
    expect(m.join()).toMatch(/camera "ghostcam".*no such channel/);
  });

  it("returns empty when every bound id is declared or a section is absent", () => {
    const m = unknownIds(reqOf({ hardwareChannels: [hw("btn", "gpio")] }), {
      hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 17 } },
    });
    expect(m).toEqual([]);
    expect(unknownIds(reqOf(), {})).toEqual([]);
  });
});

describe("valuesFileSchema", () => {
  it("accepts an empty object and a partial config", () => {
    expect(valuesFileSchema.safeParse({}).success).toBe(true);
    expect(
      valuesFileSchema.safeParse({
        hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 17 } },
        llmKeys: { anthropic: "sk-x" },
      }).success,
    ).toBe(true);
  });

  it("rejects a non-integer index and a string where a number belongs", () => {
    expect(valuesFileSchema.safeParse({ hardware: { b: { chipOrDevice: "/dev/x", index: 17.5 } } }).success).toBe(false);
    expect(valuesFileSchema.safeParse({ hardware: { b: { chipOrDevice: "/dev/x", index: "17" } } }).success).toBe(false);
  });

  it("rejects a model binding without a valid location", () => {
    expect(valuesFileSchema.safeParse({ llmModels: { m: { modelFile: "x.gguf" } } }).success).toBe(false);
    expect(valuesFileSchema.safeParse({ llmModels: { m: { location: "Device", modelFile: "x.gguf" } } }).success).toBe(false);
  });

  it("validates the camera binding: each kind needs the field that identifies it", () => {
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "v4l2", device: "/dev/video0" } } }).success).toBe(true);
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "rtsp", url: "rtsp://cam/s1" } } }).success).toBe(true);
    // libcamera and debug identify a camera on their own.
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "libcamera" } } }).success).toBe(true);
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "debug" } } }).success).toBe(true);
    // v4l2 without a device, and an unknown kind, are rejected.
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "v4l2" } } }).success).toBe(false);
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "telepathy" } } }).success).toBe(false);
    // A location has no meaning now: a camera is hardware, not an endpoint.
    expect(valuesFileSchema.safeParse({ cameras: { c: { location: "network", url: "http://cam:8100" } } }).success).toBe(false);
    // optional warmupFrames is accepted; a negative or fractional count is rejected.
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "v4l2", device: "/dev/video0", warmupFrames: 8 } } }).success).toBe(true);
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "v4l2", device: "/dev/video0", warmupFrames: -1 } } }).success).toBe(false);
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "v4l2", device: "/dev/video0", warmupFrames: 1.5 } } }).success).toBe(false);
    // optional setup commands + their device nodes; network kinds take neither.
    expect(
      valuesFileSchema.safeParse({
        cameras: { c: { kind: "v4l2", device: "/dev/video1", setup: ["media-ctl -d /dev/media2 -r"], devices: ["/dev/media2"] } },
      }).success,
    ).toBe(true);
    expect(valuesFileSchema.safeParse({ cameras: { c: { kind: "rtsp", url: "rtsp://cam/s1", setup: ["true"] } } }).success).toBe(false);
  });

  it("validates the ml model binding: both need a model name, network also a url", () => {
    expect(valuesFileSchema.safeParse({ mlModels: { m: { location: "device", model: "yolov8n" } } }).success).toBe(true);
    expect(
      valuesFileSchema.safeParse({ mlModels: { m: { location: "network", url: "http://onnx:8000", model: "yolov8n" } } })
        .success,
    ).toBe(true);
    expect(valuesFileSchema.safeParse({ mlModels: { m: { location: "device" } } }).success).toBe(false);
    expect(valuesFileSchema.safeParse({ mlModels: { m: { location: "network", model: "yolov8n" } } }).success).toBe(false);
  });
});

// The skill's example values files must stay valid against the schema — this is
// what binds the docs to the code. Read from the tracked skills/ copy.
const examplesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "skills/workflow-deploy/examples",
);

describe("skill example values files", () => {
  const files = readdirSync(examplesDir).filter((f) => f.endsWith(".values.json"));

  it("finds at least one example", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const name of files) {
    it(`${name} matches valuesFileSchema`, () => {
      const parsed: unknown = JSON.parse(readFileSync(path.join(examplesDir, name), "utf-8"));
      const result = valuesFileSchema.safeParse(parsed);
      expect(result.error?.issues ?? []).toEqual([]);
    });
  }
});
