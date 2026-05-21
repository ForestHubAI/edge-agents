// Pure conversion between the contract on-wire format (Schemas["Workflow"])
// and the in-memory domain shape (WorkflowState). No Zustand, no React, no
// DOM. Two producers feed serialize: the editor reads its live stores into
// a WorkflowState literal; the CLI calls deserialize on parsed JSON.
//
// Channels/memory files are keyed by plain id/uid in WorkflowState — editor
// store keying conventions (e.g. `ch:${id}` prefixes) are workflow-builder's
// internal concern and live in its wrapper.

import type { Schemas } from "../api";
import type { NodeInstance, FunctionInfo } from "../node";
import { getNodeOutput, isNodeUsedAsTool } from "../node/methods";
import type { EdgeInstance, EdgeType } from "../edge";
import { ALL_CHANNEL_TYPES, ApiChannel, type ChannelInstance, type ChannelType } from "../channel";
import { serialize as serializeChannel, deserialize as deserializeChannel } from "../channel";
import type { MemoryInstance } from "../memory";
import { serialize as serializeMemory, deserialize as deserializeMemory } from "../memory";
import type { ModelInstance } from "../model";
import { serialize as serializeModel, deserialize as deserializeModel } from "../model";
import { serialize as serializeNode, deserialize as deserializeNode } from "../node/serialization";
import type { Variable, NodeOutputVariable } from "../variable";
import { declaredVarKey, fnargKey, nodeOutputVarKey, ensureUids } from "../variable";
import { MAIN_CANVAS_ID, type Workflow, type Canvas } from "./Workflow";

const KNOWN_CHANNEL_TYPES = new Set<ChannelType>(ALL_CHANNEL_TYPES);

// ============================================================================
// serialize: WorkflowState (in-memory) → Schemas["Workflow"] (on-wire)
// ============================================================================

/**
 * Pure serializer: in-memory domain state → contract Workflow. Multi-canvas
 * mapping: the `main` canvas's nodes/edges/declaredVariables land at the
 * root of `Workflow`; every other canvas becomes a `Function` entry in
 * `Workflow.functions[]`, carrying its own functionInfo + outputAssignments.
 */
export function serialize(state: Workflow): Schemas["Workflow"] {
  const mainCanvas = state.canvases[MAIN_CANVAS_ID];

  const mainNodes = mainCanvas
    ? mainCanvas.nodes.map((n) => serializeNode(n.data, n.position, isNodeUsedAsTool(n.id, n.data, mainCanvas.edges)))
    : [];
  const mainEdges = mainCanvas ? mainCanvas.edges.map(toApiEdge) : [];
  const mainDeclared = mainCanvas ? extractDeclaredVariables(mainCanvas.variables) : [];

  const functions: Schemas["Function"][] = [];
  for (const [canvasId, canvas] of Object.entries(state.canvases)) {
    if (canvasId === MAIN_CANVAS_ID) continue;
    if (!canvas.functionInfo) {
      throw new Error(`[workflow-core] canvas ${canvasId} has no functionInfo — cannot serialize as a Function`);
    }
    functions.push({
      functionInfo: canvas.functionInfo,
      outputAssignments: canvas.outputAssignments ?? {},
      nodes: canvas.nodes.map((n) => serializeNode(n.data, n.position, isNodeUsedAsTool(n.id, n.data, canvas.edges))),
      edges: canvas.edges.map(toApiEdge),
      declaredVariables: extractDeclaredVariables(canvas.variables),
    });
  }

  const channels = Object.values(state.channels ?? {}).map(serializeChannel);
  const memory = Object.values(state.memory ?? {}).map(serializeMemory);
  const models = Object.values(state.models ?? {}).map(serializeModel);

  return {
    nodes: mainNodes,
    edges: mainEdges,
    functions,
    declaredVariables: mainDeclared,
    channels,
    ...(memory.length > 0 ? { memory } : {}),
    ...(models.length > 0 ? { models } : {}),
  };
}

// ============================================================================
// deserialize: Schemas["Workflow"] (on-wire) → WorkflowState (in-memory)
// ============================================================================

/**
 * Pure deserializer: contract Workflow → in-memory domain state. Variable
 * records are reconstructed per canvas (declared from the contract; fnarg
 * from `functionInfo.arguments`; node-output via {@link computeVariablesFromNodes})
 * since the contract intentionally carries only `declaredVariables` to avoid
 * redundancy.
 *
 * The outer `type` field on each CanvasData node is set to the domain node
 * type (e.g. "Agent"). Workflow-builder's wrapper translates it to the React
 * Flow display type during store hydration — that translation is editor-only.
 */
export function deserialize(workflow: Schemas["Workflow"]): Workflow {
  const canvases: Record<string, Canvas> = {};

  // Main canvas: data at the contract root; no functionInfo, empty outputAssignments.
  const mainNodes = workflow.nodes.map(toCanvasNode);
  const mainEdges = workflow.edges.map(toCanvasEdge);
  const mainDeclared = workflow.declaredVariables ?? [];
  canvases[MAIN_CANVAS_ID] = {
    nodes: mainNodes,
    edges: mainEdges,
    variables: buildCanvasVariables(
      mainNodes.map((n) => n.data),
      null,
      mainDeclared,
    ),
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
    const fnNodes = fn.nodes.map(toCanvasNode);
    const fnEdges = fn.edges.map(toCanvasEdge);
    canvases[functionInfo.id] = {
      nodes: fnNodes,
      edges: fnEdges,
      variables: buildCanvasVariables(
        fnNodes.map((n) => n.data),
        functionInfo,
        fn.declaredVariables ?? [],
      ),
      functionInfo,
      outputAssignments: fn.outputAssignments ?? {},
    };
  }

  const channels: Record<string, ChannelInstance> = {};
  for (const c of workflow.channels ?? []) {
    if (!KNOWN_CHANNEL_TYPES.has(c.type as ChannelType)) continue;
    const instance = deserializeChannel(c as ApiChannel);
    channels[instance.id] = instance;
  }

  const memory: Record<string, MemoryInstance> = {};
  for (const m of workflow.memory ?? []) {
    const instance = deserializeMemory(m);
    memory[instance.id] = instance;
  }

  const models: Record<string, ModelInstance> = {};
  for (const m of workflow.models ?? []) {
    const instance = deserializeModel(m);
    models[instance.id] = instance;
  }

  return {
    canvases,
    ...(Object.keys(channels).length > 0 ? { channels } : {}),
    ...(Object.keys(memory).length > 0 ? { memory } : {}),
    ...(Object.keys(models).length > 0 ? { models } : {}),
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
 * Ported from workflow-builder's canvasStore to take NodeInstance[] directly
 * (NodeInstance carries id at the top level — no React Flow wrapper needed).
 */
export function computeVariablesFromNodes(nodes: NodeInstance[]): Record<string, NodeOutputVariable> {
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
 *   declared (from contract)
 * + fnarg    (derived from functionInfo.arguments — only present on function canvases)
 * + nodeOutput (derived from nodes via {@link computeVariablesFromNodes})
 *
 * Disjoint key namespaces (`declared:`, `fnarg:`, `<nodeId>:<outputId>`) so
 * merge order is irrelevant. Used by both `deserialize` here and (via re-import)
 * by workflow-builder's `CanvasState.initialize`.
 */
export function buildCanvasVariables(
  nodes: NodeInstance[],
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
 * variety the contract persists). Node-output and fnarg variables are
 * reconstructed on deserialize from nodes + functionInfo.
 */
export function extractDeclaredVariables(variables: Record<string, Variable>): Schemas["Variable"][] {
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
 * Convert a contract `Node` into a `CanvasData` node (the in-memory wrapper
 * the validator + editor consume). The outer `type` is the domain node type
 * (e.g. "Agent"); workflow-builder's wrapper rewrites it to a React Flow
 * display type during store hydration.
 */
function toCanvasNode(apiNode: Schemas["Node"]): Canvas["nodes"][number] {
  const data = deserializeNode(apiNode);
  return {
    id: data.id,
    type: data.type,
    position: apiNode.position,
    data,
  };
}

/**
 * Convert a contract `Edge` into a `CanvasData` edge. Critical: the contract's
 * `id` field is preserved verbatim — earlier code synthesized `e${index+1}`,
 * which broke roundtrip identity. Edge type-conditional metadata (`prompt`
 * on agentTask/agentDelegate; `description` on agentChoice/agentDelegate)
 * is folded into `data` as `EdgeInstance`.
 */
function toCanvasEdge(apiEdge: Schemas["Edge"]): Canvas["edges"][number] {
  let data: EdgeInstance | undefined;
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
 * Convert a `CanvasData` edge into a contract `Edge`. Edge `id` is preserved
 * (contract now requires it). Edge-type-conditional metadata is reattached
 * from the edge's `data` payload.
 */
function toApiEdge(edge: Canvas["edges"][number]): Schemas["Edge"] {
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
