// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { describe, it, expect } from "vitest";
import {
  workflowBindingRequirements,
  getReferencedCatalogModelIds,
  uniquenessKey,
  bindingConflicts,
  type Requirement,
  type HardwareFamily,
} from "./requirements";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "../workflow";
import type { Channel, ChannelType } from "../channel";
import type { Model } from "../model";
import type { Memory, MemoryType } from "../memory";
import type { Node } from "../node";

function channel(id: string, type: ChannelType, args: Record<string, unknown> = {}): Channel {
  return { id, label: id, type, arguments: args };
}

// Unbound requirement builders — the workflow-derived shape, deployment holes null.
const hw = (family: HardwareFamily): Requirement => ({ kind: "hardware", family, ref: null, index: null });

const llm = (id: string): Model => ({ id, label: id, type: "LLMModel", arguments: {} });
const ml = (id: string): Model => ({ id, label: id, type: "MLModel", arguments: {} });

const memory = (id: string, type: MemoryType): Memory => ({ id, label: id, type, arguments: {} });

// Minimal Agent node referencing a catalog model by id — only the model ref
// matters to the requirement walk. Cast through the union: the other Agent args
// are irrelevant here.
function agent(id: string, model: string): Node {
  return {
    id,
    type: "Agent",
    position: { x: 0, y: 0 },
    arguments: {
      name: id,
      model,
      instructions: "",
      outputDeclarations: [],
      memoryRefs: [],
      answer: { active: true, mode: "emit", name: "answer" },
    },
  } as unknown as Node;
}

const canvas = (nodes: Node[]): Canvas => ({ nodes, edges: [], variables: {} });

// Build a workflow from parts. `nodes` fills the main canvas; pass `canvases`
// instead to model multiple bodies (main + function). Any other field
// (channels, models) overrides the empty default.
function workflow(parts: Partial<Workflow> & { nodes?: Node[] }): Workflow {
  const { nodes = [], ...rest } = parts;
  return {
    canvases: { [MAIN_CANVAS_ID]: canvas(nodes) },
    functions: {},
    channels: {},
    memory: {},
    models: {},
    ...rest,
  };
}

const byId = (chs: Channel[]): Record<string, Channel> => Object.fromEntries(chs.map((c) => [c.id, c]));
const modelsById = (ms: Model[]): Record<string, Model> => Object.fromEntries(ms.map((m) => [m.id, m]));
const memoryById = (ms: Memory[]): Record<string, Memory> => Object.fromEntries(ms.map((m) => [m.id, m]));

// CROSS-LANGUAGE CONFORMANCE. Each case below is a golden fixture: a workflow in,
// an exact id->Requirement surface out (deployment holes null — filled later by the
// consumer). The backend's deploy.WorkflowBindingRequirements must produce the
// identical map for the same workflow — mirror these fixtures on the Go side so the
// two extractors stay pinned. Divergence here is deploy drift: OSS and the backend
// disagreeing about what a workflow needs bound.
describe("workflowBindingRequirements", () => {
  it("returns an empty surface for an empty workflow", () => {
    expect(workflowBindingRequirements(workflow({}))).toEqual({});
  });

  it("maps every hardware channel family, splitting UART -> serial and gpio in/out -> gpio", () => {
    const chs = byId([
      channel("in", "GPIOIN"),
      channel("out", "GPIOOUT"),
      channel("adc", "ADC"),
      channel("dac", "DAC"),
      channel("pwm", "PWM"),
      channel("uart", "UART"),
    ]);
    const expected: Record<string, Requirement> = {
      in: hw("gpio"),
      out: hw("gpio"),
      adc: hw("adc"),
      dac: hw("dac"),
      pwm: hw("pwm"),
      uart: hw("serial"),
    };
    expect(workflowBindingRequirements(workflow({ channels: chs }))).toEqual(expected);
  });

  it("carries the MQTT topic (a workflow fact) and classifies CAMERA as hardware/camera", () => {
    const chs = byId([channel("telemetry", "MQTT", { topic: "sensors/temp" }), channel("cam0", "CAMERA")]);
    expect(workflowBindingRequirements(workflow({ channels: chs }))).toEqual({
      telemetry: { kind: "mqtt", ref: null, topic: "sensors/temp" },
      cam0: hw("camera"),
    });
  });

  it("defaults an unset MQTT topic to the empty string", () => {
    const chs = byId([channel("telemetry", "MQTT")]);
    expect(workflowBindingRequirements(workflow({ channels: chs }))).toEqual({
      telemetry: { kind: "mqtt", ref: null, topic: "" },
    });
  });

  it("binds nothing for a LOG channel", () => {
    const chs = byId([channel("log", "LOG"), channel("led", "GPIOOUT")]);
    expect(workflowBindingRequirements(workflow({ channels: chs }))).toEqual({ led: hw("gpio") });
  });

  it("splits declared models: LLMModel -> 'declaredLlm', MLModel -> 'ml'", () => {
    const models = modelsById([llm("local-llm"), ml("yolo")]);
    expect(workflowBindingRequirements(workflow({ models }))).toEqual({
      "local-llm": { kind: "declaredLlm", model: null },
      yolo: { kind: "ml", ref: null, model: null },
    });
  });

  it("maps a referenced-but-undeclared catalog model to 'catalogLlm', carrying the id as model", () => {
    const wf = workflow({ nodes: [agent("a1", "gpt-4o")] });
    expect(workflowBindingRequirements(wf)).toEqual({ "gpt-4o": { kind: "catalogLlm", model: "gpt-4o" } });
  });

  it("prefers 'declaredLlm' when an id is both declared and referenced (no overwrite)", () => {
    const wf = workflow({ models: modelsById([llm("shared")]), nodes: [agent("a1", "shared")] });
    expect(workflowBindingRequirements(wf)).toEqual({ shared: { kind: "declaredLlm", model: null } });
  });

  it("maps a declared VectorDatabase to 'rag', keyed by memory id", () => {
    const wf = workflow({ memory: memoryById([memory("vdb1", "VectorDatabase")]) });
    expect(workflowBindingRequirements(wf)).toEqual({ vdb1: { kind: "rag", ref: null } });
  });

  it("does not extract MemoryFile memory (engine workspace volume, nothing to bind)", () => {
    const wf = workflow({ memory: memoryById([memory("notes", "MemoryFile")]) });
    expect(workflowBindingRequirements(wf)).toEqual({});
  });

  // The rag requirement is the DECLARATION, not the reference: a VectorDatabase
  // with no Retriever node still resolves through the mapping at engine build.
  it("emits 'rag' for a declared VectorDatabase even with no Retriever node", () => {
    const wf = workflow({ memory: memoryById([memory("vdb1", "VectorDatabase")]), nodes: [agent("a1", "gpt-4o")] });
    expect(workflowBindingRequirements(wf)).toEqual({
      vdb1: { kind: "rag", ref: null },
      "gpt-4o": { kind: "catalogLlm", model: "gpt-4o" },
    });
  });

  it("produces the full surface for a mixed workflow", () => {
    const wf = workflow({
      channels: byId([channel("led", "GPIOOUT"), channel("telemetry", "MQTT", { topic: "t" }), channel("cam0", "CAMERA"), channel("log", "LOG")]),
      models: modelsById([llm("local-llm"), ml("yolo")]),
      memory: memoryById([memory("vdb1", "VectorDatabase"), memory("notes", "MemoryFile")]),
      nodes: [agent("a1", "claude-sonnet")],
    });
    const expected: Record<string, Requirement> = {
      led: hw("gpio"),
      telemetry: { kind: "mqtt", ref: null, topic: "t" },
      cam0: hw("camera"),
      "local-llm": { kind: "declaredLlm", model: null },
      yolo: { kind: "ml", ref: null, model: null },
      vdb1: { kind: "rag", ref: null },
      "claude-sonnet": { kind: "catalogLlm", model: "claude-sonnet" },
    };
    expect(workflowBindingRequirements(wf)).toEqual(expected);
  });
});

describe("uniquenessKey", () => {
  it("keys the index families on (family, ref, index)", () => {
    expect(uniquenessKey({ kind: "hardware", family: "gpio", ref: "chip0", index: 17 })).toBe("gpio:chip0:17");
    expect(uniquenessKey({ kind: "hardware", family: "adc", ref: "iio0", index: 0 })).toBe("adc:iio0:0");
    expect(uniquenessKey({ kind: "hardware", family: "pwm", ref: "pwm0", index: 2 })).toBe("pwm:pwm0:2");
  });

  it("keys serial and camera on ref alone (no sub-address)", () => {
    expect(uniquenessKey({ kind: "hardware", family: "serial", ref: "ttyUSB0", index: null })).toBe("serial:ttyUSB0");
    expect(uniquenessKey({ kind: "hardware", family: "camera", ref: "video0", index: null })).toBe("camera:video0");
  });

  it("keys mqtt on (ref, topic)", () => {
    expect(uniquenessKey({ kind: "mqtt", ref: "broker", topic: "alarm" })).toBe("mqtt:broker:alarm");
  });

  it("keys both LLM kinds on served model alone (one flat namespace, no ref) and ml on (ref, model)", () => {
    expect(uniquenessKey({ kind: "declaredLlm", model: "llama3" })).toBe("llm:llama3");
    expect(uniquenessKey({ kind: "catalogLlm", model: "gpt-4o" })).toBe("llm:gpt-4o");
    expect(uniquenessKey({ kind: "ml", ref: "onnx", model: "yolo" })).toBe("ml:onnx:yolo");
  });

  it("keys rag on ref (a VectorDatabase ref is its collection id, 1:1 like UART)", () => {
    expect(uniquenessKey({ kind: "rag", ref: "collection" })).toBe("rag:collection");
  });

  it("throws on an unbound field rather than skipping silently", () => {
    expect(() => uniquenessKey({ kind: "hardware", family: "gpio", ref: null, index: 17 })).toThrow(/ref not bound/);
    expect(() => uniquenessKey({ kind: "hardware", family: "gpio", ref: "chip0", index: null })).toThrow(/index not bound/);
    expect(() => uniquenessKey({ kind: "hardware", family: "serial", ref: null, index: null })).toThrow(/ref not bound/);
    expect(() => uniquenessKey({ kind: "declaredLlm", model: null })).toThrow(/model not bound/);
  });
});

describe("bindingConflicts", () => {
  it("finds no conflict when keys differ", () => {
    const reqs: Record<string, Requirement> = {
      door: { kind: "hardware", family: "gpio", ref: "chip0", index: 17 },
      window: { kind: "hardware", family: "gpio", ref: "chip0", index: 18 },
    };
    expect(bindingConflicts(reqs)).toEqual([]);
  });

  it("flags two ids on one (ref, index) / (ref, topic) / served model", () => {
    const reqs: Record<string, Requirement> = {
      a: { kind: "hardware", family: "gpio", ref: "chip0", index: 17 },
      b: { kind: "hardware", family: "gpio", ref: "chip0", index: 17 },
      alertA: { kind: "mqtt", ref: "broker", topic: "alarm" },
      alertB: { kind: "mqtt", ref: "broker", topic: "alarm" },
      m1: { kind: "declaredLlm", model: "llama3" },
      m2: { kind: "declaredLlm", model: "llama3" },
    };
    expect(bindingConflicts(reqs)).toEqual([
      { key: "gpio:chip0:17", ids: ["a", "b"] },
      { key: "mqtt:broker:alarm", ids: ["alertA", "alertB"] },
      { key: "llm:llama3", ids: ["m1", "m2"] },
    ]);
  });

  it("treats gpio in/out on one line as a conflict (shared pin space)", () => {
    const reqs: Record<string, Requirement> = {
      read: { kind: "hardware", family: "gpio", ref: "chip0", index: 4 },
      write: { kind: "hardware", family: "gpio", ref: "chip0", index: 4 },
    };
    expect(bindingConflicts(reqs)).toEqual([{ key: "gpio:chip0:4", ids: ["read", "write"] }]);
  });

  it("flags two ids on one rag collection (declared twice)", () => {
    const reqs: Record<string, Requirement> = {
      r1: { kind: "rag", ref: "collection" },
      r2: { kind: "rag", ref: "collection" },
    };
    expect(bindingConflicts(reqs)).toEqual([{ key: "rag:collection", ids: ["r1", "r2"] }]);
  });

  it("flags a self-hosted served name shadowing a catalog id (one flat LLM namespace)", () => {
    const reqs: Record<string, Requirement> = {
      // A declared model an operator served as "claude-sonnet", and the catalog
      // model of the same id referenced elsewhere — unroutable in the llmproxy.
      mine: { kind: "declaredLlm", model: "claude-sonnet" },
      "claude-sonnet": { kind: "catalogLlm", model: "claude-sonnet" },
    };
    expect(bindingConflicts(reqs)).toEqual([{ key: "llm:claude-sonnet", ids: ["mine", "claude-sonnet"] }]);
  });
});

describe("getReferencedCatalogModelIds", () => {
  it("returns catalog ids (referenced but not declared), excluding declared customs", () => {
    const wf = workflow({
      canvases: { [MAIN_CANVAS_ID]: canvas([agent("n1", "claude-opus-4-7"), agent("n2", "custom-llm")]) },
      models: modelsById([llm("custom-llm")]),
    });
    expect(getReferencedCatalogModelIds(wf)).toEqual(["claude-opus-4-7"]);
  });

  it("ignores unset model references", () => {
    const wf = workflow({ nodes: [agent("n1", "")] });
    expect(getReferencedCatalogModelIds(wf)).toEqual([]);
  });

  it("dedupes across nodes and walks every canvas (main + function bodies)", () => {
    const wf = workflow({
      canvases: {
        [MAIN_CANVAS_ID]: canvas([agent("n1", "claude-opus-4-7"), agent("n2", "claude-opus-4-7")]),
        fnBody: canvas([agent("n3", "gemini-2")]),
      },
    });
    expect(getReferencedCatalogModelIds(wf).sort()).toEqual(["claude-opus-4-7", "gemini-2"]);
  });

  it("returns nothing when every referenced model is declared", () => {
    const wf = workflow({ nodes: [agent("n1", "custom-llm")], models: modelsById([llm("custom-llm")]) });
    expect(getReferencedCatalogModelIds(wf)).toEqual([]);
  });
});
