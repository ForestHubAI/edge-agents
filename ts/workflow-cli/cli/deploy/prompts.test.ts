import { describe, it, expect, vi, beforeEach } from "vitest";
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

beforeEach(() => vi.resetAllMocks());

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
        [/publish prefix/, ""],
        [/subscribe prefix/, ""],
        [/Output directory/, "b"],
      ],
      password: [[/password/, ""]],
    });
    const cfg = await promptMissing({}, "def", reqOf({ mqttChannels: [{ id: "m", label: "m", topic: "t" }] }));
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
});
