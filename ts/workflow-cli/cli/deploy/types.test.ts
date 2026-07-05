// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { familyMismatches, ggufNameError, hardwareConflicts, unknownIds, valuesFileSchema } from "./types";
import type { DeployRequirements, HardwareChannel, HardwareFamily } from "./types";

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

const hw = (id: string, family: HardwareFamily): HardwareChannel => ({
  id,
  label: id,
  family,
  addressable: family !== "serial",
});

describe("hardwareConflicts", () => {
  it("allows two channels on the same chip with different lines", () => {
    const conflicts = hardwareConflicts([hw("btn", "gpio"), hw("led", "gpio")], {
      btn: { chipOrDevice: "/dev/gpiochip0", index: 17 },
      led: { chipOrDevice: "/dev/gpiochip0", index: 27 },
    });
    expect(conflicts).toEqual([]);
  });

  it("flags two channels on the same chip and line", () => {
    const conflicts = hardwareConflicts([hw("btn", "gpio"), hw("led", "gpio")], {
      btn: { chipOrDevice: "/dev/gpiochip0", index: 17 },
      led: { chipOrDevice: "/dev/gpiochip0", index: 17 },
    });
    expect(conflicts.join()).toMatch(/led/);
    expect(conflicts.join()).toMatch(/line 17.*already used by "btn"/);
  });

  it("treats a serial device as exclusive, regardless of baud", () => {
    const conflicts = hardwareConflicts([hw("u1", "serial"), hw("u2", "serial")], {
      u1: { chipOrDevice: "/dev/ttyUSB0", baud: 9600 },
      u2: { chipOrDevice: "/dev/ttyUSB0", baud: 115200 },
    });
    expect(conflicts.join()).toMatch(/u2.*already used by "u1"/);
  });

  it("does not collide across families", () => {
    const conflicts = hardwareConflicts([hw("a", "adc"), hw("p", "pwm")], {
      a: { chipOrDevice: "/sys/devices/x", index: 0 },
      p: { chipOrDevice: "/sys/devices/x", index: 0 },
    });
    expect(conflicts).toEqual([]);
  });

  it("skips incomplete bindings — completeness is a separate check", () => {
    const conflicts = hardwareConflicts([hw("btn", "gpio"), hw("led", "gpio")], {
      btn: { chipOrDevice: "/dev/gpiochip0", index: 17 },
      led: { chipOrDevice: "/dev/gpiochip0" },
    });
    expect(conflicts).toEqual([]);
  });
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

const reqOf = (p: Partial<DeployRequirements> = {}): DeployRequirements => ({
  hasProviderModel: false,
  hasRetriever: false,
  hardwareChannels: [],
  mqttChannels: [],
  customModels: [],
  hasWebSearch: false,
  ...p,
});

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

  it("flags unknown mqtt and model ids with the right noun", () => {
    const m = unknownIds(reqOf(), {
      mqtt: { ghost: { brokerUrl: "tcp://x:1883" } },
      models: { phantom: { location: "device", modelFile: "x.gguf" } },
    });
    expect(m.join()).toMatch(/mqtt "ghost".*no such channel/);
    expect(m.join()).toMatch(/model "phantom".*no such model/);
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
    expect(valuesFileSchema.safeParse({ models: { m: { modelFile: "x.gguf" } } }).success).toBe(false);
    expect(valuesFileSchema.safeParse({ models: { m: { location: "Device", modelFile: "x.gguf" } } }).success).toBe(false);
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
