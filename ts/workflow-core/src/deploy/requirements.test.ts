// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { describe, it, expect } from "vitest";
import { getReferencedCatalogModelIds } from "./requirements";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "../workflow";
import type { Node } from "../node";
import type { Model } from "../model";

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
  } as Node;
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
