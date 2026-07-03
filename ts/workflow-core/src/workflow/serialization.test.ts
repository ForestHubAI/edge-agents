import { describe, it, expect } from "vitest";
import { serialize, deserialize, computeVariablesFromNodes, buildCanvasVariables } from "./serialization";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "./Workflow";
import type { Schemas } from "../api";
import type { NodeData } from "../node";

// ============================================================================
// Reverse roundtrip: api JSON → deserialize → serialize → deep-equal JSON
//
// This direction is the strongest invariant — deserialize is the function
// that reconstructs derivable state (variable records); if it gets the rest
// right, re-serialize must produce the same JSON back. Tests every code path
// in deserialize + serialize without separately constructing WorkflowState.
// ============================================================================

const empty: Schemas["Workflow"] = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  functions: [],
  declaredVariables: [],
  channels: [],
  memory: [],
  models: [],
};

const mainOnly: Schemas["Workflow"] = {
  schemaVersion: 1,
  nodes: [
    {
      id: "n1",
      type: "Agent",
      position: { x: 100, y: 200 },
      label: "My Agent",
      arguments: {
        name: "agent-1",
        model: "claude-opus-4-7",
        instructions: "be helpful",
        outputDeclarations: [],
        memoryRefs: [],
        answer: { active: true, mode: "emit", name: "answer" },
      },
    },
  ],
  edges: [],
  functions: [],
  declaredVariables: [
    { uid: "d1", name: "counter", dataType: "int", initialValue: 0 },
  ],
  channels: [],
  memory: [],
  models: [],
};

const allEdgeTypes: Schemas["Workflow"] = {
  schemaVersion: 1,
  nodes: [],
  edges: [
    { id: "edge-control", type: "control", from: { nodeId: "a", port: "out" }, to: { nodeId: "b", port: "in" } },
    { id: "edge-tool", type: "tool", from: { nodeId: "a", port: "tool-out" }, to: { nodeId: "b", port: "tool-in" } },
    {
      id: "edge-task",
      type: "agentTask",
      from: { nodeId: "agent", port: "tool" },
      to: { nodeId: "task", port: "trigger" },
      prompt: { expression: '"summarize"', references: [], dataType: "string" },
    },
    {
      id: "edge-choice",
      type: "agentChoice",
      from: { nodeId: "agent", port: "choice" },
      to: { nodeId: "branchA", port: "in" },
      description: "when the user asks about weather",
    },
    {
      id: "edge-delegate",
      type: "agentDelegate",
      from: { nodeId: "agent", port: "delegate" },
      to: { nodeId: "sub", port: "in" },
      prompt: { expression: '"continue"', references: [], dataType: "string" },
      description: "delegate everything else",
    },
  ],
  functions: [],
  declaredVariables: [],
  channels: [],
  memory: [],
  models: [],
};

const withFunctionCanvas: Schemas["Workflow"] = {
  schemaVersion: 1,
  nodes: [
    {
      id: "fcall",
      type: "FunctionCall",
      position: { x: 0, y: 0 },
      // The wire stores only the reference; the signature is resolved from
      // `functions[]` and the snapshot rebuilt on deserialize.
      functionId: "fn-uuid",
      arguments: {
        inputBindings: {
          "arg-x": { expression: "1", references: [], dataType: "int" },
          "arg-y": { expression: "2", references: [], dataType: "int" },
        },
        outputBindings: {
          "ret-sum": { active: true, mode: "emit", name: "result" },
        },
      },
    },
  ],
  edges: [],
  functions: [
    {
      functionInfo: {
        id: "fn-uuid",
        version: 1,
        name: "add",
        arguments: [
          { uid: "arg-x", name: "x", dataType: "int" },
          { uid: "arg-y", name: "y", dataType: "int" },
        ],
        returns: [{ uid: "ret-sum", name: "sum", dataType: "int" }],
      },
      outputAssignments: {
        "ret-sum": { expression: "x + y", references: [
          { srcId: "fnarg", varId: "arg-x" },
          { srcId: "fnarg", varId: "arg-y" },
        ], dataType: "int" },
      },
      nodes: [],
      edges: [],
      declaredVariables: [],
    },
  ],
  declaredVariables: [],
  channels: [],
  memory: [],
  models: [],
};

describe("workflowSerialization — reverse roundtrip (JSON → deserialize → serialize)", () => {
  it("empty workflow", () => {
    expect(serialize(deserialize(empty))).toEqual(empty);
  });

  it("main canvas with declared variables and one node", () => {
    expect(serialize(deserialize(mainOnly))).toEqual(mainOnly);
  });

  it("preserves all edge type variants verbatim, including ids", () => {
    const out = serialize(deserialize(allEdgeTypes));
    expect(out).toEqual(allEdgeTypes);
    // Specific guardrail: each edge id is preserved (the bug we fixed).
    const ids = out.edges.map((e) => e.id).sort();
    expect(ids).toEqual(["edge-choice", "edge-control", "edge-delegate", "edge-task", "edge-tool"]);
  });

  it("function canvas with fnargs, output assignments, and a FunctionCall on main", () => {
    const out = serialize(deserialize(withFunctionCanvas));
    expect(out).toEqual(withFunctionCanvas);
  });

  it("preserves a CAMERA channel's width and height", () => {
    const wf: Schemas["Workflow"] = {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      functions: [],
      declaredVariables: [],
      channels: [{ type: "CAMERA", id: "cam1", label: "Front", width: 640, height: 480 }],
      memory: [],
      models: [],
    };
    expect(serialize(deserialize(wf))).toEqual(wf);
  });

  it("roundtrips a CAMERA channel that sets neither width nor height", () => {
    const wf: Schemas["Workflow"] = {
      schemaVersion: 1,
      nodes: [],
      edges: [],
      functions: [],
      declaredVariables: [],
      channels: [{ type: "CAMERA", id: "cam1", label: "Front" }],
      memory: [],
      models: [],
    };
    expect(serialize(deserialize(wf))).toEqual(wf);
  });

  it("roundtrips an MLInference node whose input is a variable reference", () => {
    const wf: Schemas["Workflow"] = {
      schemaVersion: 1,
      nodes: [
        {
          id: "ml1",
          type: "MLInference",
          position: { x: 0, y: 0 },
          arguments: {
            model: "detector",
            input: { srcId: "cam1", varId: "frame" },
            output: { active: true, mode: "emit", name: "result" },
          },
        },
      ],
      edges: [],
      functions: [],
      declaredVariables: [],
      channels: [],
      memory: [],
      models: [],
    };
    expect(serialize(deserialize(wf))).toEqual(wf);
  });
});

// ============================================================================
// Forward roundtrip: WorkflowState → serialize → deserialize → equality
//
// Variables are reconstructed from nodes + functionInfo + declared on every
// deserialize. To get exact equality, build fixtures whose `variables` field
// matches what reconstruction would produce (i.e., let buildCanvasVariables
// produce the expected value for us).
// ============================================================================

function makeMainCanvas(nodes: Canvas["nodes"] = [], edges: Canvas["edges"] = [], declared: Schemas["Variable"][] = []): Canvas {
  return {
    nodes,
    edges,
    variables: buildCanvasVariables(nodes, [], declared),
  };
}

describe("workflowSerialization — forward roundtrip (state → serialize → deserialize)", () => {
  it("empty state roundtrips to a state with an empty main canvas", () => {
    const state: Workflow = { canvases: { [MAIN_CANVAS_ID]: makeMainCanvas() }, functions: {}, channels: {}, memory: {}, models: {} };
    expect(deserialize(serialize(state))).toEqual(state);
  });

  it("preserves edge ids across serialize/deserialize", () => {
    const edges: Canvas["edges"] = [
      { id: "stable-id-A", type: "control", source: "n1", sourceHandle: "out", target: "n2", targetHandle: "in" },
      { id: "stable-id-B", type: "tool", source: "n1", sourceHandle: "tool", target: "n3", targetHandle: "in" },
    ];
    const state: Workflow = { canvases: { [MAIN_CANVAS_ID]: makeMainCanvas([], edges) }, functions: {}, channels: {}, memory: {}, models: {} };
    const roundTripped = deserialize(serialize(state));
    expect(roundTripped.canvases[MAIN_CANVAS_ID]!.edges.map((e) => e.id)).toEqual(["stable-id-A", "stable-id-B"]);
  });
});

// ============================================================================
// Variable reconstruction guardrails
// ============================================================================

describe("buildCanvasVariables", () => {
  it("reconstructs node-output variables from nodes via getNodeOutput", () => {
    const nodes: NodeData[] = [
      {
        id: "agent1",
        type: "Agent",
        arguments: {
          name: "a",
          model: "claude-opus-4-7",
          instructions: "",
          maxTurns: undefined,
          outputDeclarations: [],
          memoryRefs: [],
          answer: { active: true, mode: "emit", name: "answer" },
        },
      } as NodeData,
    ];
    const vars = computeVariablesFromNodes(nodes);
    // Agent emits at least one output (the answer); key is "<nodeId>:<outputId>".
    const keys = Object.keys(vars);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith("agent1:"))).toBe(true);
  });

  it("merges declared + fnarg + node-output into disjoint key namespaces", () => {
    const declared: Schemas["Variable"][] = [{ uid: "d1", name: "x", dataType: "int" }];
    const fnInfo = {
      id: "fn",
      version: 1,
      name: "f",
      arguments: [{ uid: "a1", name: "arg1", dataType: "int" as const }],
      returns: [],
    };
    const merged = buildCanvasVariables([], fnInfo.arguments, declared);
    expect(merged["declared:d1"]).toMatchObject({ kind: "declared", uid: "d1" });
    expect(merged["fnarg:a1"]).toMatchObject({ kind: "fnarg", uid: "a1" });
  });
});
