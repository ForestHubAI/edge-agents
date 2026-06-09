import { describe, it, expect } from "vitest";
import { inspect } from "./inspect";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";

// Loose builders: inspect only reads a few fields, so cast minimal literals into
// the strict contract unions instead of spelling out every required property.
const ch = (c: Record<string, unknown>) => c as ApiWorkflow["channels"][number];
const nd = (n: Record<string, unknown>) => n as ApiWorkflow["nodes"][number];
const fn = (nodes: ApiWorkflow["nodes"]) => ({ nodes }) as ApiWorkflow["functions"][number];
const model = (id: string) => ({ type: "LLMModel", id, label: id, capabilities: ["chat"] }) as ApiWorkflow["models"][number];
const agent = (id: string, m?: string) => nd({ id, type: "Agent", position: { x: 0, y: 0 }, arguments: m ? { model: m } : {} });

function wfOf(p: Partial<ApiWorkflow> = {}): ApiWorkflow {
  return { schemaVersion: 1, nodes: [], edges: [], functions: [], declaredVariables: [], channels: [], memory: [], models: [], ...p };
}

describe("inspect — channels", () => {
  it("sorts gpio in/out as addressable gpio", () => {
    const r = inspect(
      wfOf({ channels: [ch({ type: "GPIOIN", id: "i", label: "i", bias: "none", debounceMs: 0 }), ch({ type: "GPIOOUT", id: "o", label: "o" })] }),
    );
    expect(r.hardwareChannels).toEqual([
      { id: "i", label: "i", family: "gpio", addressable: true },
      { id: "o", label: "o", family: "gpio", addressable: true },
    ]);
  });

  it("classifies adc/dac/pwm as addressable, uart as non-addressable serial", () => {
    const r = inspect(
      wfOf({
        channels: [
          ch({ type: "ADC", id: "a", label: "a" }),
          ch({ type: "DAC", id: "d", label: "d" }),
          ch({ type: "PWM", id: "p", label: "p", frequency: 1000 }),
          ch({ type: "UART", id: "u", label: "u" }),
        ],
      }),
    );
    expect(r.hardwareChannels).toEqual([
      { id: "a", label: "a", family: "adc", addressable: true },
      { id: "d", label: "d", family: "dac", addressable: true },
      { id: "p", label: "p", family: "pwm", addressable: true },
      { id: "u", label: "u", family: "serial", addressable: false },
    ]);
  });

  it("captures mqtt channels", () => {
    const r = inspect(wfOf({ channels: [ch({ type: "MQTT", id: "m", label: "m", topic: "sensors/x" })] }));
    expect(r.mqttChannels).toEqual([{ id: "m", label: "m" }]);
    expect(r.hardwareChannels).toEqual([]);
  });
});

describe("inspect — models", () => {
  it("treats a model declared in workflow.models as custom (needs no provider key)", () => {
    const r = inspect(wfOf({ models: [model("my-llm")], nodes: [agent("a", "my-llm")] }));
    expect(r.hasProviderModel).toBe(false);
    expect(r.customModels).toEqual([{ id: "my-llm", label: "my-llm" }]);
  });

  it("flags an undeclared model as a provider (catalog) model", () => {
    const r = inspect(wfOf({ nodes: [agent("a", "gpt-x")] }));
    expect(r.hasProviderModel).toBe(true);
  });

  it("ignores an agent with no model", () => {
    const r = inspect(wfOf({ nodes: [agent("a")] }));
    expect(r.hasProviderModel).toBe(false);
  });

  it("lists every declared model regardless of agent references", () => {
    const r = inspect(wfOf({ models: [model("a"), model("b")] }));
    expect(r.customModels).toEqual([
      { id: "a", label: "a" },
      { id: "b", label: "b" },
    ]);
  });
});

describe("inspect — node features", () => {
  it("detects a Retriever node", () => {
    expect(inspect(wfOf({ nodes: [nd({ id: "r", type: "Retriever", position: { x: 0, y: 0 }, arguments: {} })] })).hasRetriever).toBe(true);
  });

  it("detects a WebSearchTool node", () => {
    expect(inspect(wfOf({ nodes: [nd({ id: "w", type: "WebSearchTool", position: { x: 0, y: 0 }, arguments: {} })] })).hasWebSearch).toBe(true);
  });

  it("scans nodes inside function bodies too", () => {
    const r = inspect(wfOf({ functions: [fn([nd({ id: "w", type: "WebSearchTool", position: { x: 0, y: 0 }, arguments: {} })])] }));
    expect(r.hasWebSearch).toBe(true);
  });
});

describe("inspect — empty", () => {
  it("reports nothing for a bare workflow", () => {
    expect(inspect(wfOf())).toEqual({
      hasProviderModel: false,
      hasRetriever: false,
      hasWebSearch: false,
      hardwareChannels: [],
      mqttChannels: [],
      customModels: [],
    });
  });
});
