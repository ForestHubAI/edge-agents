// Pure conversion between the api format (Schemas["Workflow"])
// and the domain shape (Workflow).
// Two producers feed serialize: the editor reads its live stores into
// a Workflow literal; the CLI calls deserialize on parsed JSON.

import type { Schemas } from "../api";
import type { NodeData, Node } from "../node";
import type { FunctionInfo } from "../api";
import { getNodeOutput, isNodeUsedAsTool } from "../node/methods";
import type { EdgeData, EdgeType, Edge } from "../edge";
import { ALL_CHANNEL_TYPES, type ApiChannel, type Channel, type ChannelType } from "../channel";
import { serialize as serializeChannel, deserialize as deserializeChannel } from "../channel";
import type { Memory } from "../memory";
import { serialize as serializeMemory, deserialize as deserializeMemory } from "../memory";
import type { Model } from "../model";
import { serialize as serializeModel, deserialize as deserializeModel } from "../model";
import { serialize as serializeNode, deserialize as deserializeNode } from "../node/serialization";
import type { Variable, NodeOutputVariable } from "../variable";
import { declaredVarKey, fnargKey, nodeOutputVarKey, ensureUids } from "../variable";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "./Workflow";

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
  const mainNodes = mainCanvas.nodes.map((n) => serializeNode(n, n.position, isNodeUsedAsTool(n.id, n, mainCanvas.edges)));
  const mainEdges = mainCanvas.edges.map(toApiEdge);
  const mainDeclared = extractDeclaredVariables(mainCanvas.variables);

  const functions: Schemas["Function"][] = [];
  for (const [canvasId, canvas] of Object.entries(state.canvases)) {
    if (canvasId === MAIN_CANVAS_ID) continue;
    if (!canvas.functionInfo) {
      throw new Error(`[workflow-core] canvas ${canvasId} has no functionInfo — cannot serialize as a Function`);
    }
    functions.push({
      functionInfo: canvas.functionInfo,
      outputAssignments: canvas.outputAssignments,
      nodes: canvas.nodes.map((n) => serializeNode(n, n.position, isNodeUsedAsTool(n.id, n, canvas.edges))),
      edges: canvas.edges.map(toApiEdge),
      declaredVariables: extractDeclaredVariables(canvas.variables),
    });
  }

  const channels = Object.values(state.channels).map(serializeChannel);
  const memory = Object.values(state.memory).map(serializeMemory);
  const models = Object.values(state.models).map(serializeModel);
  return {
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

  // Main canvas: data at the api root; no functionInfo, empty outputAssignments.
  const mainNodes = workflow.nodes.map(toDomainNode);
  const mainEdges = workflow.edges.map(toDomainEdge);
  const mainDeclared = workflow.declaredVariables ?? [];
  canvases[MAIN_CANVAS_ID] = {
    nodes: mainNodes,
    edges: mainEdges,
    variables: buildCanvasVariables(mainNodes, null, mainDeclared),
    functionInfo: null,
    outputAssignments: {},
  };

  // Function canvases: one per Workflow.functions[] entry, keyed by functionInfo.id.
  for (const fn of workflow.functions ?? []) {
    const functionInfo: FunctionInfo = {
      ...fn.functionInfo,
      arguments: ensureUids(fn.functionInfo.arguments),
      returns: ensureUids(fn.functionInfo.returns),
    };
    const fnNodes = fn.nodes.map(toDomainNode);
    const fnEdges = fn.edges.map(toDomainEdge);
    canvases[functionInfo.id] = {
      nodes: fnNodes,
      edges: fnEdges,
      variables: buildCanvasVariables(fnNodes, functionInfo, fn.declaredVariables ?? []),
      functionInfo,
      outputAssignments: fn.outputAssignments ?? {},
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
 * + fnarg    (derived from functionInfo.arguments — only present on function canvases)
 * + nodeOutput (derived from nodes via {@link computeVariablesFromNodes})
 *
 * Disjoint key namespaces (`declared:`, `fnarg:`, `<nodeId>:<outputId>`) so
 * merge order is irrelevant. Used by both `deserialize` here and (via re-import)
 * by workflow-builder's `CanvasState.initialize`.
 */
export function buildCanvasVariables(
  nodes: NodeData[],
  functionInfo: FunctionInfo | null,
  declaredVariables: readonly Schemas["Variable"][],
): Record<string, Variable> {
  const variables: Record<string, Variable> = computeVariablesFromNodes(nodes);
  if (functionInfo) {
    for (const arg of functionInfo.arguments) {
      variables[fnargKey(arg.uid)] = {
        kind: "fnarg",
        uid: arg.uid,
        name: arg.name,
        dataType: arg.dataType,
      };
    }
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
// Helpers — declared variables, edge & node converters
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

/**
 * Convert an api `Node` into a flat {@link Node} (the in-memory
 * domain node the validator + editor consume) by deserializing its payload
 * and attaching `position`.
 */
function toDomainNode(apiNode: Schemas["Node"]): Node {
  return { ...deserializeNode(apiNode), position: apiNode.position };
}

/**
 * Convert an api `Edge` into a `CanvasData` edge. Critical: the api's
 * `id` field is preserved verbatim — earlier code synthesized `e${index+1}`,
 * which broke roundtrip identity. Edge type-conditional metadata (`prompt`
 * on agentTask/agentDelegate; `description` on agentChoice/agentDelegate)
 * is folded into `data` as `EdgeData`.
 */
function toDomainEdge(apiEdge: Schemas["Edge"]): Edge {
  let data: EdgeData | undefined;
  if ((apiEdge.type === "agentTask" || apiEdge.type === "agentDelegate") && apiEdge.prompt) {
    data = { ...data, prompt: apiEdge.prompt };
  }
  if ((apiEdge.type === "agentChoice" || apiEdge.type === "agentDelegate") && apiEdge.description) {
    data = { ...data, description: apiEdge.description };
  }
  return {
    id: apiEdge.id,
    type: apiEdge.type,
    source: apiEdge.from.nodeId,
    sourceHandle: apiEdge.from.port,
    target: apiEdge.to.nodeId,
    targetHandle: apiEdge.to.port,
    ...(data ? { data } : {}),
  };
}

/**
 * Convert a `CanvasData` edge into an api `Edge`. Edge `id` is preserved
 * (the api now requires it). Edge-type-conditional metadata is reattached
 * from the edge's `data` payload.
 */
function toApiEdge(edge: Edge): Schemas["Edge"] {
  const sourceHandle = edge.sourceHandle || "";
  const targetHandle = edge.targetHandle || "";
  const edgeType = edge.type as EdgeType | undefined;
  const from = { nodeId: edge.source, port: sourceHandle };
  const to = { nodeId: edge.target, port: targetHandle };

  switch (edgeType) {
    case "agentTask":
      return {
        id: edge.id,
        type: "agentTask",
        from,
        to,
        prompt: (edge.data?.prompt as Schemas["Expression"]) ?? { expression: "", references: [], dataType: "string" },
      };
    case "agentChoice":
      return {
        id: edge.id,
        type: "agentChoice",
        from,
        to,
        ...(edge.data?.description ? { description: edge.data.description as string } : {}),
      };
    case "agentDelegate":
      return {
        id: edge.id,
        type: "agentDelegate",
        from,
        to,
        ...(edge.data?.prompt ? { prompt: edge.data.prompt as Schemas["Expression"] } : {}),
        ...(edge.data?.description ? { description: edge.data.description as string } : {}),
      };
    case "control":
      return { id: edge.id, type: "control", from, to };
    case "tool":
      return { id: edge.id, type: "tool", from, to };
    default:
      return {
        id: edge.id,
        type: sourceHandle.startsWith("ctrl") || targetHandle.startsWith("ctrl") ? "control" : "tool",
        from,
        to,
      };
  }
}
