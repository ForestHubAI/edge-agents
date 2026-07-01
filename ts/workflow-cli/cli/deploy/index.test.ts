import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configFromPartial, loadValues, missingRequired, parseFlags, partialFromFlags } from "./index";
import type { DeployRequirements, RawFlags } from "./types";

function flagsOf(p: Partial<RawFlags> = {}): RawFlags {
  return { llmKeys: {}, component: [], force: false, help: false, ...p };
}
function reqOf(p: Partial<DeployRequirements> = {}): DeployRequirements {
  return {
    hasProviderModel: false,
    hasRetriever: false,
    hasWebSearch: false,
    hardwareChannels: [],
    mqttChannels: [],
    customLLMModels: [],
    customMLModels: [],
    ...p,
  };
}
const hw = (id: string, family: "gpio" | "serial") => ({ id, label: id, family, addressable: family !== "serial" });

// process.exit normally kills the run; make it throw so error paths are observable.
function trapExit() {
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new Error(`exit:${c}`);
  }) as never);
}

afterEach(() => vi.restoreAllMocks());

describe("parseFlags", () => {
  it("parses provider keys, output, values, log-level and booleans", () => {
    const f = parseFlags([
      "--anthropic-key",
      "sk-a",
      "--openai-key",
      "sk-o",
      "--output",
      "dir",
      "--values",
      "v.json",
      "--log-level",
      "debug",
      "--force",
    ]);
    expect(f.llmKeys.anthropic).toBe("sk-a");
    expect(f.llmKeys.openai).toBe("sk-o");
    expect(f.output).toBe("dir");
    expect(f.values).toBe("v.json");
    expect(f.logLevel).toBe("debug");
    expect(f.force).toBe(true);
  });

  it("defaults force/help to false and leaves the rest undefined", () => {
    const f = parseFlags([]);
    expect(f.force).toBe(false);
    expect(f.help).toBe(false);
    expect(f.llmKeys.anthropic).toBeUndefined();
    expect(f.values).toBeUndefined();
  });
});

describe("partialFromFlags", () => {
  it("file is the base, an explicit flag overrides", () => {
    expect(partialFromFlags(flagsOf({ output: "flag-out" }), { outputDir: "file-out" }).outputDir).toBe("flag-out");
  });

  it("keeps the file value when the flag is absent", () => {
    expect(partialFromFlags(flagsOf(), { outputDir: "file-out" }).outputDir).toBe("file-out");
  });

  it("merges provider keys per provider, flag wins on conflict", () => {
    const p = partialFromFlags(flagsOf({ llmKeys: { anthropic: "flag-a", openai: "flag-o" } }), {
      llmKeys: { anthropic: "file-a", gemini: "file-g" },
    });
    expect(p.llmKeys).toEqual({ anthropic: "flag-a", gemini: "file-g", openai: "flag-o" });
  });

  it("exits on an invalid --log-level and honors a valid one", () => {
    trapExit();
    expect(() => partialFromFlags(flagsOf({ logLevel: "nope" }), {})).toThrow("exit:1");
    expect(partialFromFlags(flagsOf({ logLevel: "debug" }), {}).logLevel).toBe("debug");
  });
});

describe("missingRequired", () => {
  it("flags a missing device path", () => {
    expect(missingRequired(reqOf({ hardwareChannels: [hw("btn", "gpio")] }), {}).join()).toContain("btn");
  });

  it("does not flag a serial channel without an index", () => {
    const m = missingRequired(reqOf({ hardwareChannels: [hw("u", "serial")] }), {
      hardware: { u: { chipOrDevice: "/dev/ttyUSB0" } },
    });
    expect(m).toEqual([]);
  });

  it("flags missing mqtt / model / web-search values", () => {
    const m = missingRequired(
      reqOf({
        mqttChannels: [{ id: "m", label: "m" }],
        customLLMModels: [{ id: "llm", label: "llm" }],
        hasWebSearch: true,
      }),
      {},
    ).join();
    expect(m).toMatch(/m/);
    expect(m).toMatch(/llm/);
    expect(m).toMatch(/web search/i);
  });

  it("returns empty when everything is supplied", () => {
    const m = missingRequired(reqOf({ hardwareChannels: [hw("btn", "gpio")] }), {
      hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 0 } },
    });
    expect(m).toEqual([]);
  });

  it("flags two channels claiming the same chip and line", () => {
    const m = missingRequired(reqOf({ hardwareChannels: [hw("btn", "gpio"), hw("led", "gpio")] }), {
      hardware: {
        btn: { chipOrDevice: "/dev/gpiochip0", index: 17 },
        led: { chipOrDevice: "/dev/gpiochip0", index: 17 },
      },
    }).join();
    expect(m).toMatch(/already used by "btn"/);
  });

  it("flags a binding for a channel id the workflow doesn't declare", () => {
    const m = missingRequired(reqOf({ hardwareChannels: [hw("led-out", "gpio")] }), {
      hardware: {
        "led-out": { chipOrDevice: "/dev/gpiochip0", index: 27 },
        "led-out1": { chipOrDevice: "/dev/gpiochip0", index: 1 },
      },
    });
    expect(m.join()).toMatch(/led-out1.*no such channel/);
  });

  it("flags a baud on a gpio channel instead of silently ignoring it", () => {
    const m = missingRequired(reqOf({ hardwareChannels: [hw("btn", "gpio")] }), {
      hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 17, baud: 9600 } },
    }).join();
    expect(m).toMatch(/btn.*baud/);
  });

  it("flags a device model whose filename is not a .gguf", () => {
    const m = missingRequired(reqOf({ customLLMModels: [{ id: "llm", label: "llm" }] }), {
      llmModels: { llm: { location: "device", modelFile: "qwen" } },
    }).join();
    expect(m).toMatch(/llm/);
    expect(m).toMatch(/\.gguf/);
  });

  it("accepts a device model with a valid .gguf filename", () => {
    const m = missingRequired(reqOf({ customLLMModels: [{ id: "llm", label: "llm" }] }), {
      llmModels: { llm: { location: "device", modelFile: "qwen.gguf" } },
    });
    expect(m).toEqual([]);
  });
});

describe("configFromPartial", () => {
  it("fills defaults from an empty partial", () => {
    expect(configFromPartial({}, "default-out")).toEqual({
      llmKeys: {},
      outputDir: "default-out",
      force: false,
      logLevel: "info",
      hardware: {},
      mqtt: {},
      llmModels: {},
      mlModels: {},
      webSearch: undefined,
    });
  });

  it("passes through provided values", () => {
    const c = configFromPartial({ outputDir: "x", force: true, logLevel: "debug" }, "default-out");
    expect(c.outputDir).toBe("x");
    expect(c.force).toBe(true);
    expect(c.logLevel).toBe("debug");
  });
});

describe("loadValues", () => {
  it("reads and parses a JSON object file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhdeploy-"));
    const file = path.join(dir, "v.json");
    await fs.writeFile(file, JSON.stringify({ outputDir: "x", force: true }));
    expect(await loadValues(file)).toEqual({ outputDir: "x", force: true });
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exits on a missing file", async () => {
    const exit = trapExit();
    await expect(loadValues("/no/such/file.json")).rejects.toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits on malformed JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhdeploy-"));
    const file = path.join(dir, "bad.json");
    await fs.writeFile(file, "{ not json");
    trapExit();
    await expect(loadValues(file)).rejects.toThrow("exit:1");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exits when the JSON is not an object", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhdeploy-"));
    const file = path.join(dir, "arr.json");
    await fs.writeFile(file, "[1,2,3]");
    trapExit();
    await expect(loadValues(file)).rejects.toThrow("exit:1");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects a wrong type and names the exact path", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhdeploy-"));
    const file = path.join(dir, "v.json");
    await fs.writeFile(file, JSON.stringify({ hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: "17" } } }));
    trapExit();
    await expect(loadValues(file)).rejects.toThrow("exit:1");
    expect(vi.mocked(process.stderr.write).mock.calls.join("")).toContain("hardware.btn.index");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects an unknown key instead of silently ignoring it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhdeploy-"));
    const file = path.join(dir, "v.json");
    await fs.writeFile(file, JSON.stringify({ hardwre: {} }));
    trapExit();
    await expect(loadValues(file)).rejects.toThrow("exit:1");
    expect(vi.mocked(process.stderr.write).mock.calls.join("")).toContain("hardwre");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("rejects an invalid logLevel coming from the file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhdeploy-"));
    const file = path.join(dir, "v.json");
    await fs.writeFile(file, JSON.stringify({ logLevel: "verbose" }));
    trapExit();
    await expect(loadValues(file)).rejects.toThrow("exit:1");
    expect(vi.mocked(process.stderr.write).mock.calls.join("")).toContain("logLevel");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns a valid partial unchanged", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhdeploy-"));
    const file = path.join(dir, "v.json");
    const values = {
      hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 17 } },
      llmModels: { llm: { location: "device", modelFile: "qwen.gguf" } },
      logLevel: "debug",
    };
    await fs.writeFile(file, JSON.stringify(values));
    expect(await loadValues(file)).toEqual(values);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
