import { describe, it, expect } from "vitest";
import { ggufNameError, hardwareConflicts } from "./types";
import type { HardwareChannel, HardwareFamily } from "./types";

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

  it("rejects a path — only a bare filename belongs in ./models/", () => {
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
