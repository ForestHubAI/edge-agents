// Pure conversion between the api format (Schemas["Workflow"])
// and the domain shape (Workflow).
// Two producers feed serialize: the editor reads its live stores into
// a Workflow literal; the CLI calls deserialize on parsed JSON.

import type { Schemas } from "../api";
import type { NodeData } from "../node";
import type { FunctionDeclaration, FunctionInfo } from "../function";
import { serialize as serializeFunction, deserialize as deserializeFunction } from "../function";
import { getNodeOutput, isNodeUsedAsTool } from "../node/methods";
import { ALL_CHANNEL_TYPES, type ApiChannel, type Channel, type ChannelType } from "../channel";
import { serialize as serializeChannel, deserialize as deserializeChannel } from "../channel";
import type { Memory } from "../memory";
import { serialize as serializeMemory, deserialize as deserializeMemory } from "../memory";
import type { Model } from "../model";
import { serialize as serializeModel, deserialize as deserializeModel } from "../model";
import { serialize as serializeNode, deserialize as deserializeNode } from "../node";
import { serialize as serializeEdge, deserialize as deserializeEdge } from "../edge";
import type { Variable, NodeOutputVariable } from "../variable";
import { declaredVarKey, fnargKey, nodeOutputVarKey, ensureUids } from "../variable";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "./Workflow";
import { CURRENT_SCHEMA_VERSION } from "../migration";

const KNOWN_CHANNEL_TYPES = new Set<ChannelType>(ALL_CHANNEL_TYPES);

/**
 * Serialize domain → api Workflow. Multi-canvas
 * mapping: the `main` canvas's nodes/edges/declaredVariables land at the
 * root of `Workflow`; every other canvas becomes a `Function` entry in
 * `Workflow.functions[]`, carrying its own functionInfo + outputAssignments.
 */
export function serialize(state: Workflow): Schemas["Workflow"] {
  const mainCanvas = state.canvases[MAIN_CANVAS_ID];
  if (!mainCanvas) {
    throw new Error("Main canvas missing");
  }
  const mainNodes = mainCanvas.nodes.map((n) => serializeNode(n, isNodeUsedAsTool(n.id, n, mainCanvas.edges)));
  const mainEdges = mainCanvas.edges.map(serializeEdge);
  const mainDeclared = extractDeclaredVariables(mainCanvas.variables);

  // Each declaration + its body canvas (joined by id) becomes one wire Function.
  // The declaration splits into functionInfo + outputAssignments via serializeFunction.
  const functions: Schemas["Function"][] = [];
  for (const [id, decl] of Object.entries(state.functions)) {
    const body = state.canvases[id];
    if (!body) {
      throw new Error(`[workflow-core] function ${id} has no body canvas — cannot serialize`);
    }
    const { functionInfo, outputAssignments } = serializeFunction(decl);
    functions.push({
      functionInfo,
      outputAssignments,
      nodes: body.nodes.map((n) => serializeNode(n, isNodeUsedAsTool(n.id, n, body.edges))),
      edges: body.edges.map(serializeEdge),
      declaredVariables: extractDeclaredVariables(body.variables),
    });
  }

  const channels = Object.values(state.channels).map(serializeChannel);
  const memory = Object.values(state.memory).map(serializeMemory);
  const models = Object.values(state.models).map(serializeModel);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    nodes: mainNodes,
    edges: mainEdges,
    functions,
    declaredVariables: mainDeclared,
    channels,
    memory,
    models,
  };
}

/**
 * Deserialize api → domain Workflow. Variable
 * records are reconstructed per canvas (declared from the api; fnarg
 * from `functionInfo.arguments`; node-output via {@link computeVariablesFromNodes})
 * since the api intentionally carries only `declaredVariables` to avoid
 * redundancy.
 *
 * Each node is a flat {@link Node} (domain `NodeData` + `position`);
 * its `type` is the domain node type (e.g. "Agent"). Workflow-builder projects
 * that into a React Flow display type during store hydration — editor-only.
 */
export function deserialize(workflow: Schemas["Workflow"]): Workflow {
  const canvases: Record<string, Canvas> = {};
  const functions: Record<string, FunctionDeclaration> = {};

  // Pre-build the function-info table so FunctionCall nodes — on the main canvas or
  // in any function body — can rebuild their signature snapshot from the wire's
  // `functionId`. (The wire stores only the reference; the engine likewise resolves
  // by id, so the snapshot is editor-side state reconstructed here.)
  const functionInfos: Record<string, FunctionInfo> = {};
  for (const fn of workflow.functions ?? []) {
    functionInfos[fn.functionInfo.id] = {
      ...fn.functionInfo,
      arguments: ensureUids(fn.functionInfo.arguments),
      returns: ensureUids(fn.functionInfo.returns),
    };
  }
  const resolveFunctionInfo = (id: string): FunctionInfo | undefined => functionInfos[id];

  // Main canvas: data at the api root. No function declaration.
  const mainNodes = workflow.nodes.map((n) => deserializeNode(n, resolveFunctionInfo));
  const mainEdges = workflow.edges.map(deserializeEdge);
  const mainDeclared = workflow.declaredVariables ?? [];
  canvases[MAIN_CANVAS_ID] = {
    nodes: mainNodes,
    edges: mainEdges,
    variables: buildCanvasVariables(mainNodes, [], mainDeclared),
  };

  // Each wire Function splits into a project-scoped declaration (functions[id]) and
  // its body canvas (canvases[id]), joined by the function id.
  for (const fn of workflow.functions ?? []) {
    const functionInfo = functionInfos[fn.functionInfo.id]!;
    const decl = deserializeFunction(functionInfo, fn.outputAssignments ?? {});
    functions[decl.id] = decl;
    const fnNodes = fn.nodes.map((n) => deserializeNode(n, resolveFunctionInfo));
    const fnEdges = fn.edges.map(deserializeEdge);
    canvases[decl.id] = {
      nodes: fnNodes,
      edges: fnEdges,
      variables: buildCanvasVariables(fnNodes, decl.arguments, fn.declaredVariables ?? []),
    };
  }

  const channels: Record<string, Channel> = {};
  for (const c of workflow.channels ?? []) {
    if (!KNOWN_CHANNEL_TYPES.has(c.type as ChannelType)) continue;
    const instance = deserializeChannel(c as ApiChannel);
    channels[instance.id] = instance;
  }

  const memory: Record<string, Memory> = {};
  for (const m of workflow.memory ?? []) {
    const instance = deserializeMemory(m);
    memory[instance.id] = instance;
  }

  const models: Record<string, Model> = {};
  for (const m of workflow.models ?? []) {
    const instance = deserializeModel(m);
    models[instance.id] = instance;
  }

  return {
    canvases,
    functions,
    channels,
    memory,
    models,
  };
}

// ============================================================================
// Variable reconstruction
// ============================================================================

/**
 * Derive node-output variables (`{kind: "node", nodeId, outputId, ...}`)
 * from an array of node instances. Calls {@link getNodeOutput} to inspect
 * each node's declared outputs.
 *
 * Ported from workflow-builder's canvasStore to take NodeData[] directly
 * (NodeData carries id at the top level — no React Flow wrapper needed).
 */
export function computeVariablesFromNodes(nodes: NodeData[]): Record<string, NodeOutputVariable> {
  const out: Record<string, NodeOutputVariable> = {};
  for (const node of nodes) {
    for (const [outputId, variable] of Object.entries(getNodeOutput(node))) {
      out[nodeOutputVarKey(node.id, outputId)] = {
        kind: "node",
        nodeId: node.id,
        outputId,
        name: variable.name,
        dataType: variable.dataType,
      };
    }
  }
  return out;
}

/**
 * Merge the three variable sources into a single per-canvas record:
 *   declared (from api)
 * + fnarg    (derived from the function's `arguments` — empty for the main canvas)
 * + nodeOutput (derived from nodes via {@link computeVariablesFromNodes})
 *
 * Disjoint key namespaces (`declared:`, `fnarg:`, `<nodeId>:<outputId>`) so
 * merge order is irrelevant.
 */
export function buildCanvasVariables(
  nodes: NodeData[],
  fnArgs: readonly Schemas["Variable"][],
  declaredVariables: readonly Schemas["Variable"][],
): Record<string, Variable> {
  const variables: Record<string, Variable> = computeVariablesFromNodes(nodes);
  for (const arg of fnArgs) {
    variables[fnargKey(arg.uid)] = {
      kind: "fnarg",
      uid: arg.uid,
      name: arg.name,
      dataType: arg.dataType,
    };
  }
  for (const dv of declaredVariables) {
    variables[declaredVarKey(dv.uid)] = {
      kind: "declared",
      uid: dv.uid,
      name: dv.name,
      dataType: dv.dataType,
      ...(dv.initialValue !== undefined ? { initialValue: dv.initialValue } : {}),
    };
  }
  return variables;
}

// ============================================================================
// Helpers — declared variables
// ============================================================================

/**
 * Filter a canvas's variables down to the declared-kind entries (the only
 * variety the api persists). Node-output and fnarg variables are
 * reconstructed on deserialize from nodes + functionInfo.
 */
function extractDeclaredVariables(variables: Record<string, Variable>): Schemas["Variable"][] {
  const result: Schemas["Variable"][] = [];
  for (const v of Object.values(variables)) {
    if (v.kind === "declared") {
      result.push({
        uid: v.uid,
        name: v.name,
        dataType: v.dataType,
        ...(v.initialValue !== undefined ? { initialValue: v.initialValue } : {}),
      });
    }
  }
  return result;
}

