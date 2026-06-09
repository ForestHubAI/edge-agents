import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configFromPartial, loadValues, missingRequired, parseFlags, partialFromFlags } from "./index";
import type { DeployRequirements, RawFlags } from "./types";

function flagsOf(p: Partial<RawFlags> = {}): RawFlags {
  return { force: false, help: false, ...p };
}
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
    expect(f.anthropicKey).toBe("sk-a");
    expect(f.openaiKey).toBe("sk-o");
    expect(f.output).toBe("dir");
    expect(f.values).toBe("v.json");
    expect(f.logLevel).toBe("debug");
    expect(f.force).toBe(true);
  });

  it("defaults force/help to false and leaves the rest undefined", () => {
    const f = parseFlags([]);
    expect(f.force).toBe(false);
    expect(f.help).toBe(false);
    expect(f.anthropicKey).toBeUndefined();
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
    const p = partialFromFlags(flagsOf({ anthropicKey: "flag-a", openaiKey: "flag-o" }), {
      llmKeys: { anthropic: "file-a", gemini: "file-g" },
    });
    expect(p.llmKeys).toEqual({ anthropic: "flag-a", gemini: "file-g", openai: "flag-o" });
  });

  it("ignores an invalid --log-level but honors a valid one", () => {
    expect(partialFromFlags(flagsOf({ logLevel: "nope" }), { logLevel: "warn" }).logLevel).toBe("warn");
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
        customModels: [{ id: "llm", label: "llm" }],
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

  it("flags a device model whose filename is not a .gguf", () => {
    const m = missingRequired(reqOf({ customModels: [{ id: "llm", label: "llm" }] }), {
      models: { llm: { location: "device", modelFile: "qwen" } },
    }).join();
    expect(m).toMatch(/llm/);
    expect(m).toMatch(/\.gguf/);
  });

  it("accepts a device model with a valid .gguf filename", () => {
    const m = missingRequired(reqOf({ customModels: [{ id: "llm", label: "llm" }] }), {
      models: { llm: { location: "device", modelFile: "qwen.gguf" } },
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
      models: {},
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
});
