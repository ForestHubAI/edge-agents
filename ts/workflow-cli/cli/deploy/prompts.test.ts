import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";

// Replace the interactive prompt lib with mocks; each test scripts the answers.
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
}));

import { input, password, select, checkbox } from "@inquirer/prompts";
import { promptMissing } from "./prompts";
import type { DeployRequirements } from "./types";

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

function script(p: { input?: [RegExp, unknown][]; password?: [RegExp, unknown][]; select?: [RegExp, unknown][]; checkbox?: [RegExp, unknown][] }) {
  setMock(input, respond(p.input ?? []));
  setMock(password, respond(p.password ?? []));
  setMock(select, respond(p.select ?? []));
  setMock(checkbox, respond(p.checkbox ?? []));
}

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
    const cfg = await promptMissing(
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
    const cfg = await promptMissing({}, "def", reqOf({ hardwareChannels: [hwGpio("btn")] }));
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
    const cfg = await promptMissing({}, "def", reqOf({ hardwareChannels: [hwSerial("u")] }));
    expect(cfg.hardware.u).toEqual({ chipOrDevice: "/dev/ttyUSB0", baud: 9600 });
  });

  it("drops unchecked providers and prompts the checked ones", async () => {
    script({
      checkbox: [[/providers/, ["anthropic"]]],
      password: [[/anthropic API key/, "sk-x"]],
      input: [[/Output directory/, "b"]],
    });
    const cfg = await promptMissing({ llmKeys: { openai: "flag-o" } }, "def", reqOf({ hasProviderModel: true }));
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
    const cfg = await promptMissing({}, "def", reqOf({ mqttChannels: [{ id: "m", label: "m" }] }));
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
    const cfg = await promptMissing({}, "def", reqOf({ hasWebSearch: true }));
    expect(cfg.webSearch).toEqual({ provider: "brave", apiKey: "ws" });
  });

  it("device model: asks where it runs, then the model filename", async () => {
    script({
      select: [[/where does this model run/, "device"]],
      input: [
        [/model filename/, "gemma.gguf"],
        [/Output directory/, "b"],
      ],
    });
    const cfg = await promptMissing({}, "def", reqOf({ customModels: [{ id: "llm", label: "llm" }] }));
    expect(cfg.models.llm).toEqual({ location: "device", modelFile: "gemma.gguf" });
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
    const cfg = await promptMissing({}, "def", reqOf({ customModels: [{ id: "llm", label: "llm" }] }));
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
    await promptMissing({}, "def", reqOf({ hardwareChannels: [hwGpio("a"), hwGpio("b")] }));
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
    await promptMissing(
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
    await promptMissing({}, "def", reqOf({ hardwareChannels: [hwSerial("u1"), hwSerial("u2")] }));
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
    await promptMissing({}, "def", reqOf({ hardwareChannels: [hwGpio("btn")] }), "test123");
    const out = printed();
    expect(out).toContain('Standalone deployment bundle for "test123"');
    expect(out).toContain("[1/2] Hardware channels");
    expect(out).toContain("[2/2] Output");
  });

  it("counts only sections that ask — a pre-filled section gets no header or slot", async () => {
    script({});
    await promptMissing(
      { hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 1 } }, outputDir: noExistDir },
      "def",
      reqOf({ hardwareChannels: [hwGpio("btn")] }),
    );
    const out = printed();
    expect(out).not.toContain("Hardware channels");
    expect(out).toContain("[1/1] Output");
  });

  it('adds the "— N to configure" tail only when a section has more than one item', async () => {
    script({
      input: [
        [/device path/, "/dev/gpiochip0"],
        [/index/, "1"],
        [/Output directory/, "b"],
      ],
    });
    await promptMissing({}, "def", reqOf({ hardwareChannels: [hwGpio("a"), hwGpio("b")] }));
    expect(printed()).toContain("[1/2] Hardware channels — 2 to configure");
  });
});
