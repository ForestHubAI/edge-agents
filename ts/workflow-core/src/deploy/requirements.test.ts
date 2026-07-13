// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { describe, it, expect } from "vitest";
import { workflowBindingRequirements, getReferencedCatalogModelIds, type BindingKind } from "./requirements";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "../workflow";
import type { Channel, ChannelType } from "../channel";
import type { Model } from "../model";
import type { Node } from "../node";

function channel(id: string, type: ChannelType): Channel {
  return { id, label: id, type, arguments: {} };
}

const llm = (id: string): Model => ({ id, label: id, type: "LLMModel", arguments: {} });
const ml = (id: string): Model => ({ id, label: id, type: "MLModel", arguments: {} });

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

// CROSS-LANGUAGE CONFORMANCE. Each case below is a golden fixture: a workflow in,
// an exact id->kind surface out. The backend's deploy.WorkflowBindingRequirements
// must produce the identical map for the same workflow — mirror these fixtures on
// the Go side so the two extractors stay pinned. Divergence here is deploy drift:
// OSS and the backend disagreeing about what a workflow needs bound.
describe("workflowBindingRequirements", () => {
  it("returns an empty surface for an empty workflow", () => {
    expect(workflowBindingRequirements(workflow({}))).toEqual({});
  });

  it("maps every hardware channel family to 'hardware'", () => {
    const chs = byId([
      channel("in", "GPIOIN"),
      channel("out", "GPIOOUT"),
      channel("adc", "ADC"),
      channel("dac", "DAC"),
      channel("pwm", "PWM"),
      channel("uart", "UART"),
    ]);
    const expected: Record<string, BindingKind> = {
      in: "hardware",
      out: "hardware",
      adc: "hardware",
      dac: "hardware",
      pwm: "hardware",
      uart: "hardware",
    };
    expect(workflowBindingRequirements(workflow({ channels: chs }))).toEqual(expected);
  });

  it("maps MQTT to 'mqtt' and CAMERA to 'camera' (OSS-ahead kind)", () => {
    const chs = byId([channel("telemetry", "MQTT"), channel("cam0", "CAMERA")]);
    expect(workflowBindingRequirements(workflow({ channels: chs }))).toEqual({ telemetry: "mqtt", cam0: "camera" });
  });

  it("binds nothing for a LOG channel", () => {
    const chs = byId([channel("log", "LOG"), channel("led", "GPIOOUT")]);
    expect(workflowBindingRequirements(workflow({ channels: chs }))).toEqual({ led: "hardware" });
  });

  it("maps every declared model to 'declaredModel', LLM and ML alike", () => {
    const models = modelsById([llm("local-llm"), ml("yolo")]);
    expect(workflowBindingRequirements(workflow({ models }))).toEqual({ "local-llm": "declaredModel", yolo: "declaredModel" });
  });

  it("maps a referenced-but-undeclared catalog model to 'catalogModel', keyed by model id", () => {
    const wf = workflow({ nodes: [agent("a1", "gpt-4o")] });
    expect(workflowBindingRequirements(wf)).toEqual({ "gpt-4o": "catalogModel" });
  });

  it("prefers 'declaredModel' when an id is both declared and referenced (no overwrite)", () => {
    const wf = workflow({ models: modelsById([llm("shared")]), nodes: [agent("a1", "shared")] });
    expect(workflowBindingRequirements(wf)).toEqual({ shared: "declaredModel" });
  });

  it("does not extract MemoryFile / VectorDatabase memory (RAG not yet in the OSS surface)", () => {
    const wf = workflow({
      memory: { notes: { id: "notes", label: "Notes", type: "MemoryFile", arguments: {} } as Workflow["memory"][string] },
    });
    expect(workflowBindingRequirements(wf)).toEqual({});
  });

  it("produces the full surface for a mixed workflow", () => {
    const wf = workflow({
      channels: byId([channel("led", "GPIOOUT"), channel("telemetry", "MQTT"), channel("cam0", "CAMERA"), channel("log", "LOG")]),
      models: modelsById([llm("local-llm")]),
      nodes: [agent("a1", "claude-sonnet")],
    });
    const expected: Record<string, BindingKind> = {
      led: "hardware",
      telemetry: "mqtt",
      cam0: "camera",
      "local-llm": "declaredModel",
      "claude-sonnet": "catalogModel",
    };
    expect(workflowBindingRequirements(wf)).toEqual(expected);
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
