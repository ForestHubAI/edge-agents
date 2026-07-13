// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { describe, it, expect } from "vitest";
import { getReferencedCatalogModelIds, deriveRequirements } from "./requirements";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "../workflow";
import type { Channel } from "../channel";
import type { Node } from "../node";
import type { Model, ModelInfo } from "../model";

function channel(id: string, type: Channel["type"]): Channel {
  return { id, label: id, type, arguments: {} };
}

const mlModel = (id: string): Model => ({ id, label: id, type: "MLModel", arguments: {} });

// Minimal Agent node referencing `model`. Cast through the union — only id/type/
// arguments.model matter to the walk.
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

function canvas(nodes: Node[]): Canvas {
  return { nodes, edges: [], variables: {} };
}

const customModel: Model = { id: "custom-llm", label: "Custom", type: "LLMModel", arguments: {} };

function workflow(canvases: Workflow["canvases"], models: Record<string, Model> = {}): Workflow {
  return { canvases, functions: {}, channels: {}, memory: {}, models };
}

describe("getReferencedCatalogModelIds", () => {
  it("returns catalog ids (referenced but not declared), excluding declared customs", () => {
    const wf = workflow(
      { [MAIN_CANVAS_ID]: canvas([agent("n1", "claude-opus-4-7"), agent("n2", "custom-llm")]) },
      { "custom-llm": customModel },
    );
    expect(getReferencedCatalogModelIds(wf)).toEqual(["claude-opus-4-7"]);
  });

  it("ignores unset model references", () => {
    const wf = workflow({ [MAIN_CANVAS_ID]: canvas([agent("n1", "")]) });
    expect(getReferencedCatalogModelIds(wf)).toEqual([]);
  });

  it("dedupes across nodes and walks every canvas (main + function bodies)", () => {
    const wf = workflow({
      [MAIN_CANVAS_ID]: canvas([agent("n1", "claude-opus-4-7"), agent("n2", "claude-opus-4-7")]),
      fnBody: canvas([agent("n3", "gemini-2")]),
    });
    expect(getReferencedCatalogModelIds(wf).sort()).toEqual(["claude-opus-4-7", "gemini-2"]);
  });

  it("returns nothing when every referenced model is declared", () => {
    const wf = workflow({ [MAIN_CANVAS_ID]: canvas([agent("n1", "custom-llm")]) }, { "custom-llm": customModel });
    expect(getReferencedCatalogModelIds(wf)).toEqual([]);
  });
});

const catalog: ModelInfo[] = [
  { id: "claude-opus-4-7", label: "Opus", capabilities: ["chat"], provider: "anthropic" },
  { id: "claude-haiku-4-7", label: "Haiku", capabilities: ["chat"], provider: "anthropic" },
  { id: "gemini-2", label: "Gemini", capabilities: ["chat"], provider: "google" },
];

describe("deriveRequirements catalog providers", () => {
  it("resolves referenced catalog models to their distinct providers (deduped)", () => {
    const wf = workflow({
      [MAIN_CANVAS_ID]: canvas([agent("n1", "claude-opus-4-7"), agent("n2", "gemini-2"), agent("n3", "claude-haiku-4-7")]),
    });
    const req = deriveRequirements(wf, catalog);
    // Two anthropic models collapse to one provider; no per-model map is kept.
    expect(req.catalogProviders.map((p) => p.id).sort()).toEqual(["anthropic", "google"]);
    expect(req.unresolvedCatalogModels).toEqual([]);
  });

  it("flags a referenced model absent from the catalog", () => {
    const wf = workflow({ [MAIN_CANVAS_ID]: canvas([agent("n1", "gpt-5-mystery")]) });
    const req = deriveRequirements(wf, catalog);
    expect(req.catalogProviders).toEqual([]);
    expect(req.unresolvedCatalogModels).toEqual(["gpt-5-mystery"]);
  });

  it("defers provider resolution when no catalog is supplied (hasProviderModel still set)", () => {
    const wf = workflow({ [MAIN_CANVAS_ID]: canvas([agent("n1", "claude-opus-4-7")]) });
    const req = deriveRequirements(wf);
    expect(req.hasProviderModel).toBe(true);
    expect(req.catalogProviders).toEqual([]);
    expect(req.unresolvedCatalogModels).toEqual([]);
  });
});

describe("deriveRequirements resource classification", () => {
  it("classifies channels into hardware families and mqtt", () => {
    const wf: Workflow = {
      canvases: { [MAIN_CANVAS_ID]: canvas([]) },
      functions: {},
      channels: {
        led: channel("led", "GPIOOUT"),
        serial0: channel("serial0", "UART"),
        sensor: channel("sensor", "ADC"),
        telemetry: channel("telemetry", "MQTT"),
      },
      memory: {},
      models: { "custom-llm": customModel },
    };
    const req = deriveRequirements(wf);
    expect(req.hardwareChannels.map((c) => c.family).sort()).toEqual(["adc", "gpio", "serial"]);
    expect(req.mqttChannels.map((c) => c.id)).toEqual(["telemetry"]);
    expect(req.customLLMModels.map((c) => c.id)).toEqual(["custom-llm"]);
    expect(req.hardwareChannels.find((c) => c.family === "serial")?.addressable).toBe(false);
  });

  it("classifies declared models into the LLM and ML pools", () => {
    const wf = workflow({ [MAIN_CANVAS_ID]: canvas([]) }, { "custom-llm": customModel, detector: mlModel("detector") });
    const req = deriveRequirements(wf);
    expect(req.customLLMModels.map((m) => m.id)).toEqual(["custom-llm"]);
    expect(req.customMLModels.map((m) => m.id)).toEqual(["detector"]);
  });

  it("classifies camera channels into the camera pool", () => {
    const wf: Workflow = {
      canvases: { [MAIN_CANVAS_ID]: canvas([]) },
      functions: {},
      channels: { front: channel("front", "CAMERA"), rear: channel("rear", "CAMERA") },
      memory: {},
      models: {},
    };
    const req = deriveRequirements(wf);
    expect(req.cameraChannels.map((c) => c.id).sort()).toEqual(["front", "rear"]);
  });
});
