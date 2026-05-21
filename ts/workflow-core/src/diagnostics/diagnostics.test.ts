import { describe, it, expect } from "vitest";
import { computeNodeDiagnostics, type Diagnostic } from "./diagnostics";
import { NodeCategory } from "../node";
import { SetVariableNodeDefinition } from "../node/DataNode";
import { RetrieverNodeDefinition } from "../node/InputNode";
import { AgentNodeDefinition } from "../node/AgentNode";
import { OnThresholdNodeDefinition } from "../node/TriggerNode";
import { WebSearchToolNodeDefinition } from "../node/ToolNode";
import {
  diagsOfCategory,
  makeAvailableVars,
  makeDeclaredRef,
  makeDeclaredVar,
  makeEdge,
  makeExpression,
  makeChannels,
  makeNode,
  makeNodeDef,
  makeChannel,
  makeMemory,
  makeMemories,
} from "./__fixtures__/diagnosticFixtures";

// ============================================================================
// Test helpers — common base options
// ============================================================================

/**
 * Base options for a "neutral" node: real type "OnStartup" (no input ports, no tool ports,
 * no output warnings when paired with a non-Trigger synthetic definition), empty args,
 * empty variable maps. Override any field per test.
 */
function baseOpts(overrides: Partial<Parameters<typeof computeNodeDiagnostics>[0]> = {}) {
  return {
    canvasId: "main",
    nodeId: "n1",
    nodeData: makeNode("OnStartup", {}),
    nodeDefinition: makeNodeDef({ category: NodeCategory.Input }),
    availableVariables: {},
    channels: {},
    edges: [],
    ...overrides,
  };
}

// ============================================================================
// Function-call lifecycle (deleted / stale)
// ============================================================================

describe("computeNodeDiagnostics — function-call lifecycle", () => {
  it("emits function-deleted error when isDeleted is true", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({ nodeDefinition: undefined }),
      isDeleted: true,
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({
      severity: "error",
      category: "function-deleted",
      nodeId: "n1",
      canvasId: "main",
    });
  });

  it("emits function-stale warning when isStale is true", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({ nodeDefinition: undefined }),
      isStale: true,
    });
    expect(diags).toHaveLength(1);
    expect(diags[0]).toMatchObject({ severity: "warning", category: "function-stale" });
  });

  it("prefers deleted over stale when both flags are set", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({ nodeDefinition: undefined }),
      isDeleted: true,
      isStale: true,
    });
    expect(diagsOfCategory(diags, "function-deleted")).toHaveLength(1);
    expect(diagsOfCategory(diags, "function-stale")).toHaveLength(0);
  });

  it("emits no lifecycle diagnostics when neither flag is set", () => {
    const diags = computeNodeDiagnostics(baseOpts());
    expect(diagsOfCategory(diags, "function-deleted")).toHaveLength(0);
    expect(diagsOfCategory(diags, "function-stale")).toHaveLength(0);
  });
});

// ============================================================================
// Expression parameter validation
// ============================================================================

describe("computeNodeDiagnostics — expression validation", () => {
  const exprDef = makeNodeDef({
    category: NodeCategory.Input,
    parameters: [
      { id: "val", label: "Value", description: "", type: "expression", expressionType: "int" },
    ],
  });

  it("flags syntactically invalid expression", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: exprDef,
        nodeData: makeNode("OnStartup", { val: makeExpression("1 +", "int") }),
      }),
    });
    const exprDiags = diagsOfCategory(diags, "invalid-expression");
    expect(exprDiags).toHaveLength(1);
    expect(exprDiags[0].paramId).toBe("val");
    expect(exprDiags[0].message).toContain("Invalid expression");
  });

  it("accepts a well-formed expression matching declared type", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: exprDef,
        nodeData: makeNode("OnStartup", { val: makeExpression("1 + 2", "int") }),
      }),
    });
    expect(diagsOfCategory(diags, "invalid-expression")).toHaveLength(0);
  });

  it("flags expression whose result type is incompatible with expected", () => {
    // Expected int, but bool result (1 == 2)
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: exprDef,
        nodeData: makeNode("OnStartup", { val: makeExpression("1 == 2", "int") }),
      }),
    });
    const exprDiags = diagsOfCategory(diags, "invalid-expression");
    expect(exprDiags).toHaveLength(1);
    expect(exprDiags[0].message).toMatch(/Type mismatch|expected/i);
  });

  it("reactivity: changing a referenced variable's type invalidates a previously-valid expression", () => {
    // exprDef.val has a static expressionType: "int". An int var → int + 1 → int (matches).
    // The same expression with a string var → string + 1 → string (NOT int-compatible). The node
    // and definition do not change between calls; only the availableVariables map does. This is the
    // reactivity invariant the test was commissioned to prove.
    const node = makeNode("OnStartup", {
      val: makeExpression("${} + 1", "int", [makeDeclaredRef("v1")]),
    });
    const base = {
      canvasId: "main",
      nodeId: "n1",
      nodeData: node,
      nodeDefinition: exprDef,
      channels: {},
      // Connect control output so the trigger-unconnected warning doesn't muddy the picture
      edges: [makeEdge("e1", "n1", "ctrl", "n2", "ctrl")],
    };

    const before = computeNodeDiagnostics({
      ...base,
      availableVariables: makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "int" })]),
    });
    const after = computeNodeDiagnostics({
      ...base,
      availableVariables: makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "string" })]),
    });

    expect(diagsOfCategory(before, "invalid-expression")).toHaveLength(0);
    const afterExprDiags = diagsOfCategory(after, "invalid-expression");
    expect(afterExprDiags).toHaveLength(1);
    expect(afterExprDiags[0].paramId).toBe("val");
  });

  it("skips validation on inactive expression parameters", () => {
    const def = makeNodeDef({
      category: NodeCategory.Input,
      parameters: [
        { id: "mode", label: "Mode", description: "", type: "selection", options: [{ value: "on", label: "On" }, { value: "off", label: "Off" }], default: "off" },
        {
          id: "val",
          label: "Value",
          description: "",
          type: "expression",
          expressionType: "int",
          activationRules: [{ type: "parameterIn", parameterId: "mode", values: ["on"] }],
        },
      ],
    });
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: def,
        // mode=off → val inactive → garbage not validated
        nodeData: makeNode("OnStartup", { mode: "off", val: makeExpression("1 +", "int") }),
      }),
    });
    expect(diagsOfCategory(diags, "invalid-expression")).toHaveLength(0);
  });
});

// ============================================================================
// Required parameter enforcement
// ============================================================================

describe("computeNodeDiagnostics — missing required parameters", () => {
  const requiredStringDef = makeNodeDef({
    category: NodeCategory.Input,
    parameters: [{ id: "name", label: "Name", description: "", type: "string" }],
  });

  it("flags required string param with empty string", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: requiredStringDef,
        nodeData: makeNode("OnStartup", { name: "" }),
      }),
    });
    const missing = diagsOfCategory(diags, "missing-required-param");
    expect(missing).toHaveLength(1);
    expect(missing[0].paramId).toBe("name");
  });

  it("flags required expression param that is empty", () => {
    const def = makeNodeDef({
      category: NodeCategory.Input,
      parameters: [{ id: "expr", label: "Expr", description: "", type: "expression", expressionType: "int" }],
    });
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: def,
        nodeData: makeNode("OnStartup", { expr: makeExpression("", "int") }),
      }),
    });
    expect(diagsOfCategory(diags, "missing-required-param")).toHaveLength(1);
  });

  it("flags required variable-reference param with empty varId", () => {
    const def = makeNodeDef({
      category: NodeCategory.Input,
      parameters: [{ id: "ref", label: "Ref", description: "", type: "variable-reference" }],
    });
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: def,
        nodeData: makeNode("OnStartup", { ref: { srcId: "declared", varId: "" } }),
      }),
    });
    expect(diagsOfCategory(diags, "missing-required-param")).toHaveLength(1);
  });

  it("does not flag optional params that are missing", () => {
    const def = makeNodeDef({
      category: NodeCategory.Input,
      parameters: [{ id: "name", label: "Name", description: "", type: "string", optional: true }],
    });
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: def,
        nodeData: makeNode("OnStartup", {}),
      }),
    });
    expect(diagsOfCategory(diags, "missing-required-param")).toHaveLength(0);
  });

  it("does not flag required params that are inactive", () => {
    const def = makeNodeDef({
      category: NodeCategory.Input,
      parameters: [
        { id: "mode", label: "Mode", description: "", type: "selection", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
        {
          id: "extra",
          label: "Extra",
          description: "",
          type: "string",
          activationRules: [{ type: "parameterIn", parameterId: "mode", values: ["b"] }],
        },
      ],
    });
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: def,
        nodeData: makeNode("OnStartup", { mode: "a" }),
      }),
    });
    expect(diagsOfCategory(diags, "missing-required-param")).toHaveLength(0);
  });

  it("does not flag required param when it has a valid value", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: requiredStringDef,
        nodeData: makeNode("OnStartup", { name: "hello" }),
      }),
    });
    expect(diagsOfCategory(diags, "missing-required-param")).toHaveLength(0);
  });
});

// ============================================================================
// Variable-reference validation
// ============================================================================

describe("computeNodeDiagnostics — variable-reference validation", () => {
  const def = makeNodeDef({
    category: NodeCategory.Input,
    parameters: [{ id: "ref", label: "Ref", description: "", type: "variable-reference" }],
  });

  it("flags reference to a deleted variable", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: def,
        nodeData: makeNode("OnStartup", { ref: makeDeclaredRef("ghost") }),
        // ghost isn't in the map
        availableVariables: makeAvailableVars([makeDeclaredVar({ uid: "v1" })]),
      }),
    });
    const refDiags = diagsOfCategory(diags, "invalid-reference");
    expect(refDiags).toHaveLength(1);
    expect(refDiags[0].message).toMatch(/deleted variable/);
    expect(refDiags[0].paramId).toBe("ref");
  });

  it("accepts a valid variable reference", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: def,
        nodeData: makeNode("OnStartup", { ref: makeDeclaredRef("v1") }),
        availableVariables: makeAvailableVars([makeDeclaredVar({ uid: "v1" })]),
      }),
    });
    expect(diagsOfCategory(diags, "invalid-reference")).toHaveLength(0);
  });

  it("reactivity: a valid reference becomes invalid when the variable is removed", () => {
    const node = makeNode("OnStartup", { ref: makeDeclaredRef("v1") });
    const base = baseOpts({ nodeDefinition: def, nodeData: node });

    const before = computeNodeDiagnostics({
      ...base,
      availableVariables: makeAvailableVars([makeDeclaredVar({ uid: "v1" })]),
    });
    const after = computeNodeDiagnostics({ ...base, availableVariables: {} });

    expect(diagsOfCategory(before, "invalid-reference")).toHaveLength(0);
    expect(diagsOfCategory(after, "invalid-reference")).toHaveLength(1);
  });
});

// ============================================================================
// Channel select validation (channelSelect param)
// ============================================================================

describe("computeNodeDiagnostics — channelSelect validation", () => {
  const channelDef = makeNodeDef({
    category: NodeCategory.Input,
    parameters: [{ id: "pin", label: "Pin", description: "", type: "channelSelect", channelType: ["GPIOIN"] }],
  });

  it("flags reference to a deleted channel", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: channelDef,
        nodeData: makeNode("OnStartup", { pin: "ghost-pin" }),
        channels: makeChannels([makeChannel({ id: "pin1" })]),
      }),
    });
    const refDiags = diagsOfCategory(diags, "invalid-reference");
    expect(refDiags).toHaveLength(1);
    expect(refDiags[0].message).toMatch(/deleted channel/);
  });

  it("flags reference to a channel with incompatible type", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: channelDef,
        nodeData: makeNode("OnStartup", { pin: "pin1" }),
        channels: makeChannels([makeChannel({ id: "pin1", type: "ADC" })]),
      }),
    });
    const refDiags = diagsOfCategory(diags, "invalid-reference");
    expect(refDiags).toHaveLength(1);
    expect(refDiags[0].message).toMatch(/not a compatible channel type/);
  });

  it("accepts reference to a channel with compatible type", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: channelDef,
        nodeData: makeNode("OnStartup", { pin: "pin1" }),
        channels: makeChannels([makeChannel({ id: "pin1", type: "GPIOIN" })]),
      }),
    });
    expect(diagsOfCategory(diags, "invalid-reference")).toHaveLength(0);
  });

  it("accepts any of several allowed types", () => {
    const multiTypeDef = makeNodeDef({
      category: NodeCategory.Input,
      parameters: [{ id: "pin", label: "Pin", description: "", type: "channelSelect", channelType: ["GPIOIN", "ADC"] }],
    });
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: multiTypeDef,
        nodeData: makeNode("OnStartup", { pin: "pin1" }),
        channels: makeChannels([makeChannel({ id: "pin1", type: "ADC" })]),
      }),
    });
    expect(diagsOfCategory(diags, "invalid-reference")).toHaveLength(0);
  });
});

// ============================================================================
// memorySelect validation
// ============================================================================

describe("computeNodeDiagnostics — memorySelect validation", () => {
  const memDef = makeNodeDef({
    category: NodeCategory.Input,
    parameters: [{ id: "col", label: "Vector DB", description: "", type: "memorySelect", memoryType: ["VectorDatabase"] }],
  });

  it("flags a memory id not present in the store", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: memDef,
        nodeData: makeNode("OnStartup", { col: "deleted-mem" }),
      }),
      memory: makeMemories([makeMemory({ id: "vdb1", type: "VectorDatabase" })]),
    });
    const refDiags = diagsOfCategory(diags, "invalid-reference");
    expect(refDiags).toHaveLength(1);
    expect(refDiags[0].message).toMatch(/deleted memory/);
  });

  it("accepts a memory id present in the store with a compatible type", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: memDef,
        nodeData: makeNode("OnStartup", { col: "vdb1" }),
      }),
      memory: makeMemories([makeMemory({ id: "vdb1", type: "VectorDatabase" })]),
    });
    expect(diagsOfCategory(diags, "invalid-reference")).toHaveLength(0);
  });

  it("flags a memory of an incompatible type", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: memDef,
        nodeData: makeNode("OnStartup", { col: "file1" }),
      }),
      memory: makeMemories([makeMemory({ id: "file1", type: "MemoryFile" })]),
    });
    const refDiags = diagsOfCategory(diags, "invalid-reference");
    expect(refDiags).toHaveLength(1);
    expect(refDiags[0].message).toMatch(/not a compatible memory type/);
  });

  it("does not flag when the memory map is undefined (not provided)", () => {
    const diags = computeNodeDiagnostics({
      ...baseOpts({
        nodeDefinition: memDef,
        nodeData: makeNode("OnStartup", { col: "vdb1" }),
      }),
    });
    expect(diagsOfCategory(diags, "invalid-reference")).toHaveLength(0);
  });
});

// ============================================================================
// Scalar output-binding validation (uses RetrieverNode — real node with static output)
// ============================================================================

describe("computeNodeDiagnostics — scalar output binding validation", () => {
  // Common valid retriever args (satisfies required params so assign-type-mismatch is isolated)
  const retrieverArgs = (outputBinding: unknown) => ({
    memoryReference: "vdb1",
    topK: 5,
    query: makeExpression("hello", "string"),
    output: outputBinding,
  });
  const retrieverBase = (outputBinding: unknown, availableVariables: Record<string, ReturnType<typeof makeDeclaredVar>> = {}) => ({
    canvasId: "main",
    nodeId: "n1",
    nodeData: makeNode("Retriever", retrieverArgs(outputBinding)),
    nodeDefinition: RetrieverNodeDefinition,
    availableVariables,
    channels: {},
    memory: makeMemories([makeMemory({ id: "vdb1", type: "VectorDatabase" })]),
    edges: [
      makeEdge("e-in", "trigger", "ctrl", "n1", "ctrl"), // wire control input to silence unconnected-input
      makeEdge("e-out", "n1", "ctrl", "sink", "ctrl"),    // wire output to silence trigger
    ],
  });

  it("flags assign-mode output binding with empty srcId", () => {
    const diags = computeNodeDiagnostics(retrieverBase({ active: true, mode: "assign", target: { srcId: "", varId: "v1" } }));
    const assignDiags = diagsOfCategory(diags, "assign-type-mismatch");
    expect(assignDiags).toHaveLength(1);
    expect(assignDiags[0].message).toMatch(/no variable selected/);
  });

  it("flags assign-mode binding targeting a deleted variable", () => {
    const diags = computeNodeDiagnostics(retrieverBase({ active: true, mode: "assign", target: makeDeclaredRef("ghost") }));
    const assignDiags = diagsOfCategory(diags, "assign-type-mismatch");
    expect(assignDiags).toHaveLength(1);
    expect(assignDiags[0].message).toMatch(/deleted variable/);
  });

  it("flags assign-mode binding with type mismatch", () => {
    const diags = computeNodeDiagnostics(
      retrieverBase(
        { active: true, mode: "assign", target: makeDeclaredRef("v1") },
        makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "int" })]), // retriever output is string
      ),
    );
    const assignDiags = diagsOfCategory(diags, "assign-type-mismatch");
    expect(assignDiags).toHaveLength(1);
    expect(assignDiags[0].message).toMatch(/cannot assign/);
  });

  it("accepts assign-mode binding with matching types", () => {
    const diags = computeNodeDiagnostics(
      retrieverBase(
        { active: true, mode: "assign", target: makeDeclaredRef("v1") },
        makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "string" })]),
      ),
    );
    expect(diagsOfCategory(diags, "assign-type-mismatch")).toHaveLength(0);
  });

  it("skips validation entirely for inactive bindings (discarded)", () => {
    // Inactive binding preserves a broken assign target as draft state — must not fire diagnostics.
    const diags = computeNodeDiagnostics(
      retrieverBase({ active: false, mode: "assign", target: { srcId: "", varId: "" } }),
    );
    expect(diagsOfCategory(diags, "assign-type-mismatch")).toHaveLength(0);
  });

  it("skips output-binding validation entirely when node is used as tool", () => {
    // Retriever has a tool input port; connecting it marks the node as used-as-tool.
    const diags = computeNodeDiagnostics({
      ...retrieverBase({ active: true, mode: "assign", target: { srcId: "", varId: "" } }), // would normally fire
      edges: [makeEdge("e-tool", "agent", "tools", "n1", "tool")],
    });
    expect(diagsOfCategory(diags, "assign-type-mismatch")).toHaveLength(0);
  });
});

// ============================================================================
// List-output entry validation (uses AgentNode — real node with list output)
// ============================================================================

describe("computeNodeDiagnostics — list-output entry validation", () => {
  const agentBase = (outputDeclarations: unknown[], availableVariables: Record<string, ReturnType<typeof makeDeclaredVar>> = {}) => ({
    canvasId: "main",
    nodeId: "n1",
    nodeData: makeNode("Agent", {
      name: "a",
      model: "gpt-4",
      instructions: "",
      maxTurns: 10,
      options: undefined,
      outputDeclarations,
      answer: { active: true, mode: "emit", name: "answer" },
    }),
    nodeDefinition: AgentNodeDefinition,
    availableVariables,
    channels: {},
    edges: [makeEdge("e-in", "trigger", "ctrl", "n1", "ctrl")],
  });

  it("flags list entry with empty srcId", () => {
    const diags = computeNodeDiagnostics(
      agentBase([{ mode: "assign", name: "score", dataType: "string", target: { srcId: "", varId: "" } }]),
    );
    const entry = diagsOfCategory(diags, "assign-type-mismatch");
    expect(entry).toHaveLength(1);
    expect(entry[0].outputId).toBe("outputDeclarations[0]");
    expect(entry[0].message).toMatch(/entry #1 has no variable selected/);
  });

  it("flags list entry targeting a deleted variable", () => {
    const diags = computeNodeDiagnostics(
      agentBase([{ mode: "assign", name: "score", dataType: "string", target: makeDeclaredRef("ghost") }]),
    );
    const entry = diagsOfCategory(diags, "assign-type-mismatch");
    expect(entry).toHaveLength(1);
    expect(entry[0].message).toMatch(/deleted variable/);
  });

  it("flags list entry with type mismatch", () => {
    const diags = computeNodeDiagnostics(
      agentBase(
        [{ mode: "assign", name: "score", dataType: "int", target: makeDeclaredRef("v1") }],
        makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "string" })]),
      ),
    );
    const entry = diagsOfCategory(diags, "assign-type-mismatch");
    expect(entry).toHaveLength(1);
    expect(entry[0].message).toMatch(/cannot assign/);
  });

  it("accepts a valid list entry", () => {
    const diags = computeNodeDiagnostics(
      agentBase(
        [{ mode: "assign", name: "score", dataType: "int", target: makeDeclaredRef("v1") }],
        makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "int" })]),
      ),
    );
    expect(diagsOfCategory(diags, "assign-type-mismatch")).toHaveLength(0);
    expect(diagsOfCategory(diags, "duplicate-output-name")).toHaveLength(0);
  });

  it("reports only the broken entry when one of several is invalid", () => {
    const diags = computeNodeDiagnostics(
      agentBase(
        [
          { mode: "assign", name: "a", dataType: "int", target: makeDeclaredRef("v1") }, // ok
          { mode: "assign", name: "b", dataType: "int", target: { srcId: "", varId: "" } }, // broken
          { mode: "emit", uid: "u2", name: "ok", dataType: "int" }, // emit — skipped
        ],
        makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "int" })]),
      ),
    );
    const entry = diagsOfCategory(diags, "assign-type-mismatch");
    expect(entry).toHaveLength(1);
    expect(entry[0].outputId).toBe("outputDeclarations[1]");
  });

  it("flags duplicate names across the list (both modes)", () => {
    // Two entries share the name "score" — the JSON property name in the LLM's response
    // would silently collide. Diagnostic must fire on both colliding entries.
    const diags = computeNodeDiagnostics(
      agentBase(
        [
          { mode: "emit", uid: "u1", name: "score", dataType: "int" },
          { mode: "assign", name: "score", dataType: "int", target: makeDeclaredRef("v1") },
        ],
        makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "int" })]),
      ),
    );
    const dupes = diagsOfCategory(diags, "duplicate-output-name");
    expect(dupes).toHaveLength(2);
    expect(dupes.map((d) => d.outputId).sort()).toEqual(["outputDeclarations[0]", "outputDeclarations[1]"]);
  });

  it("flags entry with empty name", () => {
    const diags = computeNodeDiagnostics(
      agentBase([{ mode: "emit", uid: "u1", name: "", dataType: "int" }]),
    );
    const missing = diagsOfCategory(diags, "missing-required-param").filter((d) => d.outputId);
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toMatch(/has no name/);
  });
});

// ============================================================================
// Control-port connectivity (uses SetVariable — real node with control input)
// ============================================================================

describe("computeNodeDiagnostics — control-input connectivity", () => {
  // SetVariable has a control input "ctrl" and a control output "ctrl". Use it with a
  // valid variable and value so the only remaining signal is the port connectivity.
  const svArgs = {
    variable: makeDeclaredRef("v1"),
    value: makeExpression("1", "int"),
  };
  const svVars = makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "int" })]);

  it("warns when a node with control inputs has none connected", () => {
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("SetVariable", svArgs),
      nodeDefinition: SetVariableNodeDefinition,
      availableVariables: svVars,
      channels: {},
      edges: [],
    });
    expect(diagsOfCategory(diags, "unconnected-input")).toHaveLength(1);
  });

  it("does not warn when a control input is connected", () => {
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("SetVariable", svArgs),
      nodeDefinition: SetVariableNodeDefinition,
      availableVariables: svVars,
      channels: {},
      edges: [makeEdge("e1", "trigger", "ctrl", "n1", "ctrl")],
    });
    expect(diagsOfCategory(diags, "unconnected-input")).toHaveLength(0);
  });

  it("does not warn when a node has no control inputs at all", () => {
    // OnStartup has zero input ports
    const diags = computeNodeDiagnostics(baseOpts());
    expect(diagsOfCategory(diags, "unconnected-input")).toHaveLength(0);
  });
});

// ============================================================================
// Tool-only connectivity (uses WebSearchTool — tool input only)
// ============================================================================

describe("computeNodeDiagnostics — tool-not-connected", () => {
  it("warns when a tool-only node is not connected to any agent", () => {
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("WebSearchTool", {}),
      nodeDefinition: WebSearchToolNodeDefinition,
      availableVariables: {},
      channels: {},
      edges: [],
    });
    expect(diagsOfCategory(diags, "tool-not-connected")).toHaveLength(1);
  });

  it("does not warn when a tool-only node is connected to an agent", () => {
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("WebSearchTool", {}),
      nodeDefinition: WebSearchToolNodeDefinition,
      availableVariables: {},
      channels: {},
      edges: [makeEdge("e1", "agent", "tools", "n1", "tool")],
    });
    expect(diagsOfCategory(diags, "tool-not-connected")).toHaveLength(0);
  });

  it("does not emit tool-not-connected for nodes that also have control inputs", () => {
    // Retriever has both control input and tool input — the control-input branch handles it,
    // so the tool-not-connected branch must not fire.
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("Retriever", {
        memoryReference: "vdb1",
        topK: 5,
        query: makeExpression("hi", "string"),
        output: { active: true, mode: "emit", name: "out" },
      }),
      nodeDefinition: RetrieverNodeDefinition,
      availableVariables: {},
      channels: {},
      memory: makeMemories([makeMemory({ id: "vdb1", type: "VectorDatabase" })]),
      edges: [],
    });
    expect(diagsOfCategory(diags, "tool-not-connected")).toHaveLength(0);
  });
});

// ============================================================================
// Trigger-output connectivity (uses OnThreshold — Trigger category, control output)
// ============================================================================

describe("computeNodeDiagnostics — trigger output connectivity", () => {
  const onThresholdArgs = {
    value: makeExpression("1", "float"),
    threshold: 100,
    direction: "above",
  };

  it("warns when a trigger's control output is unconnected", () => {
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("OnThreshold", onThresholdArgs),
      nodeDefinition: OnThresholdNodeDefinition,
      availableVariables: {},
      channels: {},
      edges: [],
    });
    expect(diagsOfCategory(diags, "unconnected-output")).toHaveLength(1);
  });

  it("does not warn when the trigger's output is connected", () => {
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("OnThreshold", onThresholdArgs),
      nodeDefinition: OnThresholdNodeDefinition,
      availableVariables: {},
      channels: {},
      edges: [makeEdge("e1", "n1", "ctrl", "sink", "ctrl")],
    });
    expect(diagsOfCategory(diags, "unconnected-output")).toHaveLength(0);
  });

  it("does not warn on non-trigger nodes with unconnected control outputs", () => {
    // SetVariable has a control output but category is Data, not Trigger — should not fire.
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("SetVariable", {
        variable: makeDeclaredRef("v1"),
        value: makeExpression("1", "int"),
      }),
      nodeDefinition: SetVariableNodeDefinition,
      availableVariables: makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "int" })]),
      channels: {},
      edges: [makeEdge("e1", "trigger", "ctrl", "n1", "ctrl")], // control input wired
    });
    expect(diagsOfCategory(diags, "unconnected-output")).toHaveLength(0);
  });
});

// ============================================================================
// Undefined nodeDefinition (defensive path) + happy path
// ============================================================================

describe("computeNodeDiagnostics — edge cases", () => {
  it("returns early when nodeDefinition is undefined and node is not a deleted/stale function", () => {
    const diags = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("OnStartup", {}),
      nodeDefinition: undefined,
      availableVariables: {},
      channels: {},
      edges: [],
    });
    expect(diags).toHaveLength(0);
  });

  it("returns no diagnostics for a fully valid node (happy path baseline)", () => {
    const diags: Diagnostic[] = computeNodeDiagnostics({
      canvasId: "main",
      nodeId: "n1",
      nodeData: makeNode("SetVariable", {
        variable: makeDeclaredRef("v1"),
        value: makeExpression("${} + 1", "int", [makeDeclaredRef("v1")]),
      }),
      nodeDefinition: SetVariableNodeDefinition,
      availableVariables: makeAvailableVars([makeDeclaredVar({ uid: "v1", dataType: "int" })]),
      channels: {},
      edges: [
        makeEdge("e-in", "trigger", "ctrl", "n1", "ctrl"),
        makeEdge("e-out", "n1", "ctrl", "sink", "ctrl"),
      ],
    });
    expect(diags).toEqual([]);
  });
});
