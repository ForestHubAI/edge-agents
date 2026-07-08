// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Replace the interactive prompt lib with mocks; each test scripts the answers.
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  confirm: vi.fn(),
}));

import { input, password, select, checkbox, confirm } from "@inquirer/prompts";
import { promptMissing } from "./prompts";
import type { DeployConfig, DeployRequirements } from "./types";

function reqOf(p: Partial<DeployRequirements> = {}): DeployRequirements {
  return {
    hasProviderModel: false,
    catalogProviders: [],
    catalogModelProviders: {},
    unresolvedCatalogModels: [],
    hasRetriever: false,
    hasWebSearch: false,
    hardwareChannels: [],
    mqttChannels: [],
    customModels: [],
    ...p,
  };
}
const hwGpio = (id: string) => ({ id, label: id, family: "gpio" as const, addressable: true });
const hwSerial = (id: string) => ({ id, label: id, family: "serial" as const, addressable: false });

// Answer a prompt by matching its message against [regex, value] pairs; an
// unmatched prompt throws, so a test never silently drives the wrong path.
type Responder = (o: { message: string }) => Promise<unknown>;
const respond =
  (map: [RegExp, unknown][]): Responder =>
  async (o) => {
    for (const [re, val] of map) if (re.test(o.message)) return val;
    throw new Error(`unexpected prompt: ${o.message}`);
  };
const setMock = (fn: unknown, r: Responder) => (fn as { mockImplementation: (f: Responder) => void }).mockImplementation(r);

function script(p: { input?: [RegExp, unknown][]; password?: [RegExp, unknown][]; select?: [RegExp, unknown][]; checkbox?: [RegExp, unknown][]; confirm?: [RegExp, unknown][] }) {
  setMock(input, respond(p.input ?? []));
  setMock(password, respond(p.password ?? []));
  setMock(select, respond(p.select ?? []));
  setMock(checkbox, respond(p.checkbox ?? []));
  // The custom-components section always asks its yes/no gate; default to no so a
  // test that doesn't care about components is never forced to script it.
  setMock(confirm, respond(p.confirm ?? [[/custom component/, false]]));
}

// promptMissing now returns the whole interactive result (config + custom
// components + their env); these tests assert on the config, with no preloaded
// --component folders. The component section itself is covered in components.test.ts.
const run = async (
  partial: Partial<DeployConfig>,
  def: string,
  req: DeployRequirements,
  name = "wf",
): Promise<DeployConfig> => (await promptMissing(partial, def, req, name, [])).config;

const noExistDir = path.join(os.tmpdir(), "fhprompt-does-not-exist-xyz");

// promptMissing prints section headers to stdout; capture them on a spy so they
// don't clutter the test run, while still letting tests assert on what was printed.
let stdout: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
});
afterEach(() => stdout.mockRestore());

describe("promptMissing", () => {
  it("asks nothing when the partial pre-filled everything", async () => {
    script({});
    const cfg = await run(
      { hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 1 } }, outputDir: noExistDir },
      "def",
      reqOf({ hardwareChannels: [hwGpio("btn")] }),
    );
    expect(cfg.hardware.btn).toEqual({ chipOrDevice: "/dev/gpiochip0", index: 1 });
    expect(cfg.outputDir).toBe(noExistDir);
    expect(input).not.toHaveBeenCalled();
  });

  it("prompts a gpio channel for device path and index", async () => {
    script({
      input: [
        [/device path/, "/dev/gpiochip0"],
        [/index/, "7"],
        [/Output directory/, "bundle"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ hardwareChannels: [hwGpio("btn")] }));
    expect(cfg.hardware.btn).toEqual({ chipOrDevice: "/dev/gpiochip0", index: 7 });
    expect(cfg.outputDir).toBe("bundle");
  });

  it("prompts a serial channel for baud and no index", async () => {
    script({
      input: [
        [/device path/, "/dev/ttyUSB0"],
        [/baud/, "9600"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ hardwareChannels: [hwSerial("u")] }));
    expect(cfg.hardware.u).toEqual({ chipOrDevice: "/dev/ttyUSB0", baud: 9600 });
  });

  it("drops unchecked providers and prompts the checked ones", async () => {
    script({
      checkbox: [[/providers/, ["anthropic"]]],
      password: [[/anthropic API key/, "sk-x"]],
      input: [[/Output directory/, "b"]],
    });
    const cfg = await run({ llmKeys: { openai: "flag-o" } }, "def", reqOf({ hasProviderModel: true }));
    expect(cfg.llmKeys).toEqual({ anthropic: "sk-x" });
  });

  it("attaches only the broker URL when optional mqtt fields are blank", async () => {
    script({
      input: [
        [/broker URL/, "tcp://b:1883"],
        [/username/, ""],
        [/Output directory/, "b"],
      ],
      password: [[/password/, ""]],
    });
    const cfg = await run({}, "def", reqOf({ mqttChannels: [{ id: "m", label: "m" }] }));
    expect(cfg.mqtt.m).toEqual({ brokerUrl: "tcp://b:1883" });
  });

  it("prompts web search provider and key when a WebSearchTool exists", async () => {
    script({
      input: [
        [/Web search provider/, "brave"],
        [/Output directory/, "b"],
      ],
      password: [[/Web search API key/, "ws"]],
    });
    const cfg = await run({}, "def", reqOf({ hasWebSearch: true }));
    expect(cfg.webSearch).toEqual({ provider: "brave", apiKey: "ws" });
  });

  it("device model: asks where it runs, filename, context size, and port", async () => {
    script({
      select: [[/where does this model run/, "device"]],
      input: [
        [/model filename/, "gemma.gguf"],
        [/context window/, "8192"],
        [/sidecar port/, "9090"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ customModels: [{ id: "llm", label: "llm" }] }));
    expect(cfg.models.llm).toEqual({ location: "device", modelFile: "gemma.gguf", ctxSize: 8192, port: 9090 });
  });

  it("network model: asks where it runs, then url + key", async () => {
    script({
      select: [[/where does this model run/, "network"]],
      input: [
        [/endpoint URL/, "http://x:8080"],
        [/Output directory/, "b"],
      ],
      password: [[/API key/, "sk-1"]],
    });
    const cfg = await run({}, "def", reqOf({ customModels: [{ id: "llm", label: "llm" }] }));
    expect(cfg.models.llm).toEqual({ location: "network", url: "http://x:8080", apiKey: "sk-1" });
  });

  // The mocks answer prompts without running their validate callbacks; these
  // tests pull a recorded call's validate out and invoke it like inquirer would.
  type PromptCall = { message: string; validate?: (v: string) => string | boolean };
  const promptCalls = (re: RegExp): PromptCall[] =>
    (input as unknown as { mock: { calls: [PromptCall][] } }).mock.calls.map((c) => c[0]).filter((o) => re.test(o.message));

  it("rejects a GPIO line an earlier channel already claimed", async () => {
    script({
      input: [
        [/device path/, "/dev/gpiochip0"],
        [/index/, "17"],
        [/Output directory/, "b"],
      ],
    });
    await run({}, "def", reqOf({ hardwareChannels: [hwGpio("a"), hwGpio("b")] }));
    const validate = promptCalls(/index/)[1]?.validate;
    expect(validate?.("17")).toMatch(/already used by "a"/);
    expect(validate?.("18")).toBe(true);
  });

  it("counts a pre-filled (--values) address as claimed in the live check", async () => {
    script({
      input: [
        [/device path/, "/dev/gpiochip0"],
        [/index/, "5"],
        [/Output directory/, "b"],
      ],
    });
    await run(
      { hardware: { a: { chipOrDevice: "/dev/gpiochip0", index: 17 } } },
      "def",
      reqOf({ hardwareChannels: [hwGpio("a"), hwGpio("b")] }),
    );
    const validate = promptCalls(/index/)[0]?.validate;
    expect(validate?.("17")).toMatch(/already used by "a"/);
  });

  it("rejects a serial device another channel already uses", async () => {
    script({
      input: [
        [/device path/, "/dev/ttyUSB0"],
        [/baud/, "9600"],
        [/Output directory/, "b"],
      ],
    });
    await run({}, "def", reqOf({ hardwareChannels: [hwSerial("u1"), hwSerial("u2")] }));
    const validate = promptCalls(/device path/)[1]?.validate;
    expect(validate?.("/dev/ttyUSB0")).toMatch(/already used by "u1"/);
    expect(validate?.("/dev/ttyUSB1")).toBe(true);
  });

  // Everything printed to stdout this run, concatenated, for header assertions.
  const printed = () => stdout.mock.calls.map((c: unknown[]) => String(c[0])).join("");

  it("prints the intro and numbers each active section against the active total", async () => {
    script({
      input: [
        [/device path/, "/dev/gpiochip0"],
        [/index/, "1"],
        [/Output directory/, "b"],
      ],
    });
    await run({}, "def", reqOf({ hardwareChannels: [hwGpio("btn")] }), "test123");
    const out = printed();
    expect(out).toContain('Standalone deployment bundle for "test123"');
    expect(out).toContain("[1/3] Hardware channels");
    expect(out).toContain("[2/3] Custom components");
    expect(out).toContain("[3/3] Output");
  });

  it("counts only sections that ask — a pre-filled section gets no header or slot", async () => {
    script({ input: [[/Output directory/, "b"]] });
    await run(
      { hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 1 } } },
      "def",
      reqOf({ hardwareChannels: [hwGpio("btn")] }),
    );
    const out = printed();
    expect(out).not.toContain("Hardware channels");
    expect(out).toContain("[1/2] Custom components");
    expect(out).toContain("[2/2] Output");
  });

  it("skips the Output section when the directory is pre-filled and free", async () => {
    script({
      input: [
        [/device path/, "/dev/gpiochip0"],
        [/index/, "1"],
      ],
    });
    await run({ outputDir: noExistDir }, "def", reqOf({ hardwareChannels: [hwGpio("btn")] }));
    const out = printed();
    expect(out).toContain("[1/2] Hardware channels");
    expect(out).toContain("[2/2] Custom components");
    expect(out).not.toContain("Output");
  });

  it("keeps the Output section when the pre-filled directory collides", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhprompt-"));
    await fs.writeFile(path.join(dir, "stale.txt"), "x");
    script({ select: [[/is not empty/, "overwrite"]] });
    const cfg = await run({ outputDir: dir }, "def", reqOf());
    expect(printed()).toContain("[2/2] Output");
    expect(cfg.force).toBe(true);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('adds the "— N to configure" tail only when a section has more than one item', async () => {
    script({
      input: [
        [/device path/, "/dev/gpiochip0"],
        [/index/, "1"],
        [/Output directory/, "b"],
      ],
    });
    await run({}, "def", reqOf({ hardwareChannels: [hwGpio("a"), hwGpio("b")] }));
    expect(printed()).toContain("[1/3] Hardware channels — 2 to configure");
  });
});
