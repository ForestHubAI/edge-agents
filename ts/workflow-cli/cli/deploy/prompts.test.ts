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
  editor: vi.fn(),
}));

import { input, password, select, checkbox, confirm, editor } from "@inquirer/prompts";
import { promptMissing } from "./prompts";
import type { DeployConfig, DeployRequirements } from "./types";

function reqOf(p: Partial<DeployRequirements> = {}): DeployRequirements {
  return {
    hasProviderModel: false,
    catalogProviders: [],
    unresolvedCatalogModels: [],
    hasRetriever: false,
    hasWebSearch: false,
    hardwareChannels: [],
    mqttChannels: [],
    cameraChannels: [],
    customLLMModels: [],
    customMLModels: [],
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

function script(p: { input?: [RegExp, unknown][]; password?: [RegExp, unknown][]; select?: [RegExp, unknown][]; checkbox?: [RegExp, unknown][]; confirm?: [RegExp, unknown][]; editor?: [RegExp, unknown][] }) {
  setMock(input, respond(p.input ?? []));
  setMock(password, respond(p.password ?? []));
  setMock(select, respond(p.select ?? []));
  setMock(checkbox, respond(p.checkbox ?? []));
  // Yes/no gates a test usually doesn't care about default to no: the
  // custom-components section (always offered) and a camera's setup commands.
  setMock(confirm, respond(p.confirm ?? [[/custom component/, false], [/setup commands/, false]]));
  setMock(editor, respond(p.editor ?? []));
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

  it("prompts one key per referenced catalog provider, skipping flag-supplied ones", async () => {
    script({
      password: [
        [/Anthropic API key/, "sk-a"],
        [/OpenAI API key/, "sk-o"],
      ],
      input: [[/Output directory/, "b"]],
    });
    // OpenAI key arrives via flag/--values → not re-prompted; Anthropic is asked.
    const cfg = await run(
      { llmKeys: { OpenAI: "flag-o" } },
      "def",
      reqOf({ catalogProviders: [{ id: "Anthropic" }, { id: "OpenAI" }] }),
    );
    expect(cfg.llmKeys).toEqual({ OpenAI: "flag-o", Anthropic: "sk-a" });
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
        [/component port/, "9090"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ customLLMModels: [{ id: "llm", label: "llm" }] }));
    expect(cfg.llmModels.llm).toEqual({ location: "device", modelFile: "gemma.gguf", ctxSize: 8192, port: 9090 });
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
    const cfg = await run({}, "def", reqOf({ customLLMModels: [{ id: "llm", label: "llm" }] }));
    expect(cfg.llmModels.llm).toEqual({ location: "network", url: "http://x:8080", apiKey: "sk-1" });
  });

  it("device ml model: asks where it runs, then the model name", async () => {
    script({
      select: [[/where does this model run/, "device"]],
      input: [
        [/model name the component selects on/, "yolov8n"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ customMLModels: [{ id: "yolo", label: "yolo" }] }));
    expect(cfg.mlModels.yolo).toEqual({ location: "device", model: "yolov8n" });
  });

  it("network ml model: asks where it runs, then the model name and url", async () => {
    script({
      select: [[/where does this model run/, "network"]],
      input: [
        [/model name the component selects on/, "yolov8n"],
        [/endpoint URL/, "http://onnx:8000"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ customMLModels: [{ id: "yolo", label: "yolo" }] }));
    expect(cfg.mlModels.yolo).toEqual({ location: "network", url: "http://onnx:8000", model: "yolov8n" });
  });

  it("device camera (v4l2): asks where it runs, source, then the device path", async () => {
    script({
      select: [
        [/where does this camera run/, "device"],
        [/capture source/, "v4l2"],
      ],
      input: [
        [/device path/, "/dev/video2"],
        [/warmup frames/, "0"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ cameraChannels: [{ id: "front", label: "front" }] }));
    expect(cfg.cameras.front).toEqual({ location: "device", source: "v4l2", device: "/dev/video2" });
  });

  it("device camera (gstreamer): asks source, then the source element", async () => {
    script({
      select: [
        [/where does this camera run/, "device"],
        [/capture source/, "gstreamer"],
      ],
      input: [
        [/gstreamer source element/, "libcamerasrc"],
        [/warmup frames/, "0"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ cameraChannels: [{ id: "csi", label: "csi" }] }));
    expect(cfg.cameras.csi).toEqual({ location: "device", source: "gstreamer", device: "libcamerasrc" });
  });

  it("device camera: keeps warmupFrames when set above zero", async () => {
    script({
      select: [
        [/where does this camera run/, "device"],
        [/capture source/, "gstreamer"],
      ],
      input: [
        [/gstreamer source element/, "libcamerasrc"],
        [/warmup frames/, "8"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ cameraChannels: [{ id: "csi", label: "csi" }] }));
    expect(cfg.cameras.csi).toEqual({ location: "device", source: "gstreamer", device: "libcamerasrc", warmupFrames: 8 });
  });

  it("device camera: collects setup commands via the editor and their device nodes", async () => {
    script({
      select: [
        [/where does this camera run/, "device"],
        [/capture source/, "v4l2"],
      ],
      confirm: [
        [/setup commands/, true],
        [/custom component/, false],
      ],
      // Comment and blank lines are dropped; command lines survive verbatim.
      editor: [[/setup commands/, "# from the board docs\nmedia-ctl -d /dev/media2 -r\n\nv4l2-ctl -d /dev/v4l-subdev7 --set-ctrl=exposure=1800\n"]],
      input: [
        [/device path/, "/dev/video1"],
        [/warmup frames/, "0"],
        [/device nodes/, "  /dev/media2   /dev/v4l-subdev7 "],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ cameraChannels: [{ id: "cam", label: "cam" }] }));
    expect(cfg.cameras.cam).toEqual({
      location: "device",
      source: "v4l2",
      device: "/dev/video1",
      setup: ["media-ctl -d /dev/media2 -r", "v4l2-ctl -d /dev/v4l-subdev7 --set-ctrl=exposure=1800"],
      devices: ["/dev/media2", "/dev/v4l-subdev7"],
    });
  });

  it("device camera: an editor that returns nothing is caught, and continuing drops the setup step", async () => {
    script({
      select: [
        [/where does this camera run/, "device"],
        [/capture source/, "v4l2"],
      ],
      confirm: [
        [/add setup commands/, true],
        [/continue without a setup step/, true],
        [/custom component/, false],
      ],
      // Only comments come back -> empty after filtering -> the guard fires.
      editor: [[/setup commands/, "# I quit without writing anything\n"]],
      input: [
        [/device path/, "/dev/video1"],
        [/warmup frames/, "0"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ cameraChannels: [{ id: "cam", label: "cam" }] }));
    // No setup / devices keys — the empty result did not silently become a setup step.
    expect(cfg.cameras.cam).toEqual({ location: "device", source: "v4l2", device: "/dev/video1" });
  });

  it("network camera: asks where it runs, then url", async () => {
    script({
      select: [[/where does this camera run/, "network"]],
      input: [
        [/capture endpoint URL/, "http://cam:8100"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await run({}, "def", reqOf({ cameraChannels: [{ id: "cam", label: "cam" }] }));
    expect(cfg.cameras.cam).toEqual({ location: "network", url: "http://cam:8100" });
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
