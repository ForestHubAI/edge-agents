// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import {
  NodeBase,
  NodeCategory,
  NodeDefinition,
  NodeData,
  NodeOutput,
  NodeRegistry,
  NodeType,
  OutputBinding,
  FunctionCallNode,
  FunctionNodeDefinition,
  getArguments,
  getNodeOutput,
} from "@foresthubai/workflow-core/node";
import type { Expression } from "@foresthubai/workflow-core";
import type { FunctionInfo } from "@foresthubai/workflow-core/function";
import type { OutputDeclaration } from "@foresthubai/workflow-core/parameter";
import { addEdge, Connection, Edge, Node } from "@xyflow/react";
import type { EdgeData, EdgeType } from "@foresthubai/workflow-core/edge";
import { CanvasStore } from "../stores/canvasStore";
import { computeVariablesFromNodes } from "@foresthubai/workflow-core/workflow";
import { nodeOutputVarKey, paramKey } from "@foresthubai/workflow-core/variable";
import { isExpression } from "@foresthubai/workflow-core/expression";
import { isValidConnection } from "./connectionRules";
import { generateId } from "@foresthubai/workflow-core/id";
import { uniqueName } from "./resourceHelpers";

// ============================================================================
// Output Name Deduplication
// ============================================================================

/** Collect all output variable names currently in the store. */
function collectVariableNames(store: CanvasStore): Set<string> {
  const vars = store.getState().variables;
  return new Set(Object.values(vars).map((v) => v.name));
}

/**
 * Walk a node instance and rename any emit bindings/declarations whose name collides
 * with `existingNames`. Mutates in place. Handles all three locations:
 *  - Static outputs, incl. FunctionCall returns (direct field on arguments — OutputBinding)
 *  - List output entries (each entry IS an OutputDeclaration — mutate its `name` field directly
 *    when mode === "emit". Assign-mode entries have no name to rename, so they're skipped.)
 * `existingNames` is updated with each rename so subsequent calls see the new names.
 */
function deduplicateEmitNames(node: NodeData, existingNames: Set<string>): void {
  const args = node.arguments as Record<string, unknown>;

  const renameBindingAt = (key: string): void => {
    const binding = args[key] as OutputBinding | undefined;
    // Only active emit bindings produce a variable that could collide.
    if (!binding || !binding.active || binding.mode !== "emit" || !existingNames.has(binding.name)) return;
    const deduped = uniqueName(binding.name, existingNames);
    existingNames.add(deduped);
    args[key] = { active: true, mode: "emit", name: deduped };
  };

  if (node.type === "FunctionCall") {
    for (const ret of node.functionInfo.returns) {
      renameBindingAt(paramKey(ret));
    }
    return;
  }

  const def = NodeRegistry.getByType(node.type);
  if (!def?.outputs) return;

  for (const out of def.outputs) {
    if (out.type === "static") {
      renameBindingAt(out.id);
    } else {
      const entries = (args[out.id] as OutputDeclaration[] | undefined) ?? [];
      for (const entry of entries) {
        if (entry.mode !== "emit") continue;
        if (!existingNames.has(entry.name)) continue;
        const deduped = uniqueName(entry.name, existingNames);
        existingNames.add(deduped);
        entry.name = deduped;
      }
    }
  }
}

// ============================================================================
// Pure Store Operations
// ============================================================================

/** Check if a node definition can be added to the store (respects isUnremovable and isSingleton). */
export function canAddNode(store: CanvasStore, nodeDef: NodeDefinition): boolean {
  if (nodeDef.isUnremovable) return false;
  if (nodeDef.isSingleton) {
    const { nodes } = store.getState();
    if (nodes.some((n) => n.data.type === nodeDef.type)) return false;
  }
  return true;
}

/** Add a node to the store given a node definition and optional position. Returns the new node ID, or null if the node cannot be added. */
export function addNodeToStore(store: CanvasStore, nodeDef: NodeDefinition, position?: { x: number; y: number }): string | null {
  if (!canAddNode(store, nodeDef)) return null;

  const nodeId = generateId();

  // Initialize parameters with default values. Clone so object/array defaults
  // (Expression, weekdays `[]`, memory-refs `[]`) aren't shared by reference
  // across instances or with the definition itself — a shared mutable default
  // would alias on edit.
  const args: Record<string, unknown> = {};
  nodeDef.parameters.forEach((param) => {
    if (param.default !== undefined) {
      args[param.id] = structuredClone(param.default);
    }
  });

  // Seed outputs directly into args:
  //  - Static outputs: `args[out.id] = { active: true, mode: "emit", name: out.id }` (OutputBinding)
  //  - List outputs: `args[out.id] = []` (empty OutputDeclaration[] — user adds entries)
  for (const out of nodeDef.outputs ?? []) {
    if (out.type === "static") {
      args[out.id] = { active: true, mode: "emit", name: out.id };
    } else {
      args[out.id] = [];
    }
  }

  const nodeData: NodeBase = {
    id: nodeId,
    type: nodeDef.type,
    arguments: args,
  };
  if (nodeDef.type === "FunctionCall") {
    const functionDef = nodeDef as FunctionNodeDefinition;
    const functionNode = nodeData as FunctionCallNode;
    functionNode.functionInfo = functionDef.functionInfo;
    // Seed input bindings keyed by arg uid — empty expressions with the declared dataType.
    // Output bindings were already seeded above by the generic outputs[] loop since
    // buildFunctionNodeDef now emits real StaticOutput entries.
    for (const arg of functionDef.functionInfo.arguments) {
      args[paramKey(arg)] = { expression: "", references: [], dataType: arg.dataType };
    }
    // Generic seeding uses the output id as the default emit name, but for function
    // returns we want the return's variable name.
    for (const ret of functionDef.functionInfo.returns) {
      args[paramKey(ret)] = { active: true, mode: "emit" as const, name: ret.name };
    }
  }

  // Deduplicate emit binding names against existing variables on the canvas
  const existingNames = collectVariableNames(store);
  deduplicateEmitNames(nodeData as NodeData, existingNames);

  // Nudge position if another node is already nearby (avoids stacking on click-to-add)
  const currentNodes = store.getState().nodes;
  let pos = position || { x: 250, y: 100 };
  const SNAP_DISTANCE = 50;
  while (currentNodes.some((n) => Math.abs(n.position.x - pos.x) < SNAP_DISTANCE && Math.abs(n.position.y - pos.y) < SNAP_DISTANCE)) {
    pos = { x: pos.x + 40, y: pos.y + 40 };
  }

  const newNode: Node<NodeData> = {
    id: nodeData.id,
    type: getReactFlowType(nodeDef.type),
    position: pos,
    data: nodeData as NodeData,
  };

  const { setNodes, setVariables } = store.getState();
  setNodes((nds) => [...nds, newNode]);

  // Add new node's output variables to store (computed via getNodeOutput)
  setVariables((vars) => ({ ...vars, ...computeVariablesFromNodes([newNode.data]) }));

  return nodeId;
}

/**
 * Update a node's data in the store. Returns true if the node was found and updated.
 *
 * FunctionCallNode is no longer a special case — its arguments are flat, so the same
 * shallow-merge path handles input edits, output binding edits, and migrations uniformly.
 * Migration callers simply pass the full replacement arguments record alongside
 * `functionInfo`; normal edits pass the single changed key.
 */
export function updateNodeInStore(
  store: CanvasStore,
  nodeId: string,
  updates: {
    arguments?: Record<string, unknown>;
    label?: string;
    functionInfo?: FunctionInfo;
  },
): boolean {
  const { setNodes, setVariables } = store.getState();

  // Track output changes to update variables store
  let oldOutputs: Record<string, NodeOutput> = {};
  let newOutputs: Record<string, NodeOutput> = {};
  let outputsChanged = false;
  let found = false;

  setNodes((nds) => {
    const targetNodeIndex = nds.findIndex((node) => node.id === nodeId);
    if (targetNodeIndex === -1) return nds;

    const targetNode = nds[targetNodeIndex];
    if (!targetNode) return nds;
    found = true;
    const currentData = targetNode.data as NodeData;
    oldOutputs = getNodeOutput(currentData);

    // When functionInfo changes (FunctionCall signature update), arguments are a
    // full replacement so stale keys for removed args/returns get dropped;
    // otherwise shallow-merge.
    let updatedNodeData: NodeData;

    if (updates.arguments) {
      const mergedArgs = updates.functionInfo
        ? updates.arguments
        : { ...(currentData.arguments as Record<string, unknown>), ...updates.arguments };
      updatedNodeData = {
        ...(currentData as Record<string, unknown>),
        ...updates,
        arguments: mergedArgs,
      } as NodeData;
    } else {
      updatedNodeData = { ...(currentData as Record<string, unknown>), ...updates } as NodeData;
    }

    newOutputs = getNodeOutput(updatedNodeData);

    // Build the updated nodes array
    const updatedNodes = nds.map((node, index) => {
      if (index === targetNodeIndex) {
        return { ...node, data: updatedNodeData };
      }
      return node;
    }) as Node<NodeData>[];

    // Check if any output variable changed (keys added/removed or values changed)
    const oldKeys = Object.keys(oldOutputs);
    const newKeys = Object.keys(newOutputs);
    outputsChanged =
      oldKeys.length !== newKeys.length ||
      newKeys.some((key) => {
        const oldVar = oldOutputs[key];
        const newVar = newOutputs[key];
        return !oldVar || !newVar || oldVar.name !== newVar.name || oldVar.dataType !== newVar.dataType;
      });

    return updatedNodes;
  });

  // Update variables store if outputs changed
  if (outputsChanged) {
    setVariables((vars) => {
      const updated = { ...vars };
      // Remove old outputs that no longer exist in new outputs
      for (const outputId of Object.keys(oldOutputs)) {
        if (!(outputId in newOutputs)) {
          delete updated[nodeOutputVarKey(nodeId, outputId)];
        }
      }
      // Add/update new outputs (only if actually changed)
      for (const [outputId, variable] of Object.entries(newOutputs)) {
        const key = nodeOutputVarKey(nodeId, outputId);
        const oldVar = vars[key];
        if (!oldVar || oldVar.name !== variable.name || oldVar.dataType !== variable.dataType) {
          updated[key] = { kind: "node", nodeId, outputId, name: variable.name, dataType: variable.dataType };
        }
      }
      return updated;
    });
  }

  return found;
}

/**
 * Delete a node from the store, removing connected edges and variables.
 * Takes optional getNodeDefinition callback for isUnremovable check.
 * Returns true if the node was deleted.
 */
export function deleteNodeFromStore(
  store: CanvasStore,
  nodeId: string,
  getNodeDefinition?: (node: NodeData) => NodeDefinition | undefined,
): boolean {
  const { nodes, edges, setNodes, setEdges, setVariables } = store.getState();

  // Check if node can be deleted
  const nodeToDelete = nodes.find((node) => node.id === nodeId);
  if (!nodeToDelete) return false;

  if (getNodeDefinition) {
    const nodeDef = getNodeDefinition(nodeToDelete.data);
    if (nodeDef?.isUnremovable ?? false) return false;
  }

  setNodes((nds) => nds.filter((node) => node.id !== nodeId));
  setEdges((eds) => eds.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));

  // Remove deleted node's emitted variables from store
  const outputKeys = Object.keys(getNodeOutput(nodeToDelete.data));
  if (outputKeys.length > 0) {
    setVariables((vars) => {
      const updated = { ...vars };
      for (const outputId of outputKeys) {
        delete updated[nodeOutputVarKey(nodeId, outputId)];
      }
      return updated;
    });
  }

  return true;
}

/**
 * Determine the specific edge type based on base port type and connected nodes.
 * Agent nodes get specialized control-edge types (agentTask, agentChoice, agentDelegate).
 * Tool edges have no agent-specific variant — every tool edge points at an agent.
 */
function resolveEdgeType(basePortType: EdgeType, sourceNode: Node<NodeData>, targetNode: Node<NodeData>): EdgeType {
  const sourceIsAgent = sourceNode.data.type === "Agent";
  const targetIsAgent = targetNode.data.type === "Agent";

  if (basePortType === "control") {
    if (sourceIsAgent && targetIsAgent) return "agentDelegate";
    if (targetIsAgent) return "agentTask";
    if (sourceIsAgent) return "agentChoice";
    return "control";
  }
  return basePortType;
}

/** Add an edge if the connection is valid. Returns true if the edge was added. */
export function connectNodesInStore(store: CanvasStore, connection: Connection): EdgeType | false {
  const { nodes, edges, setEdges } = store.getState();

  const portType = isValidConnection(connection.source, connection.target, connection.sourceHandle, connection.targetHandle, nodes, edges);
  if (!portType) return false;

  const sourceNode = nodes.find((n) => n.id === connection.source);
  const targetNode = nodes.find((n) => n.id === connection.target);
  if (!sourceNode || !targetNode) return false;

  const edgeType = resolveEdgeType(portType, sourceNode, targetNode);
  setEdges((eds) => addEdge({ ...connection, type: edgeType }, eds) as typeof eds);
  return edgeType;
}

/** Update an edge's data in the store. Returns true if the edge was found and updated. */
export function updateEdgeInStore(store: CanvasStore, edgeId: string, updates: Record<string, unknown>): boolean {
  const { edges, setEdges } = store.getState();
  const edge = edges.find((e) => e.id === edgeId);
  if (!edge) return false;

  setEdges((eds) => eds.map((e) => (e.id === edgeId ? { ...e, data: { ...e.data, ...updates } as EdgeData } : e)));
  return true;
}

/** Delete edges by ID from the store. */
export function deleteEdgesFromStore(store: CanvasStore, edgeIds: string[]): void {
  const { setEdges } = store.getState();
  const idSet = new Set(edgeIds);
  setEdges((eds) => eds.filter((e) => !idSet.has(e.id)));
}

// ============================================================================
// Clipboard
// ============================================================================

export interface Clipboard {
  nodes: Node<NodeData>[];
  edges: Edge<EdgeData>[];
}

export interface PasteResult {
  pasted: boolean;
  /** Labels of nodes that were skipped because they cannot be added (singleton already present or unremovable). */
  skippedLabels: string[];
}

/** Paste clipboard contents into the store with new IDs and optional position offset. */
export function pasteToStore(
  store: CanvasStore,
  clipboard: Clipboard,
  offset: { x: number; y: number } = { x: 50, y: 50 },
  getNodeDefinition?: (node: NodeData) => NodeDefinition | undefined,
): PasteResult {
  const empty: PasteResult = { pasted: false, skippedLabels: [] };
  if (clipboard.nodes.length === 0) return empty;

  const { setNodes, setEdges, setVariables } = store.getState();

  // Filter out nodes that cannot be pasted (unremovable or singleton already on canvas)
  const skippedLabels: string[] = [];
  const pastableNodes = clipboard.nodes.filter((node) => {
    if (!getNodeDefinition) return true;
    const def = getNodeDefinition(node.data);
    if (!def) return true;
    if (!canAddNode(store, def)) {
      skippedLabels.push(def.label);
      return false;
    }
    return true;
  });

  if (pastableNodes.length === 0) return { pasted: false, skippedLabels };

  // Build old ID -> new ID mapping (only for pastable nodes)
  const idMap = new Map<string, string>();
  pastableNodes.forEach((node) => {
    const newId = generateId();
    idMap.set(node.id, newId);
  });

  // Create new nodes with updated IDs and positions
  const newNodes: Node<NodeData>[] = pastableNodes.map((node) => {
    const newId = idMap.get(node.id)!;

    // Deep copy and update node data
    const newData = JSON.parse(JSON.stringify(node.data)) as NodeData;
    newData.id = newId;

    // Update expression references to point to new node IDs
    newData.arguments = updateExpressionsInArgs(getArguments(newData), idMap) as typeof newData.arguments;

    return {
      ...node,
      id: newId,
      position: {
        x: node.position.x + offset.x,
        y: node.position.y + offset.y,
      },
      data: newData,
      selected: true,
    };
  });

  // Dedupe emit binding names on pasted nodes against existing variables.
  // (Pasted nodes come from JSON.parse(JSON.stringify(...)) of live nodes, so
  // their bindings are already present in the correct arguments locations.)
  const existingNames = collectVariableNames(store);
  for (const node of newNodes) {
    deduplicateEmitNames(node.data, existingNames);
  }

  // Create new edges with updated IDs (only for edges where both nodes are pasted)
  const newEdges: Edge<EdgeData>[] = clipboard.edges
    .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge) => {
      const newEdge = {
        ...edge,
        id: generateId(),
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
        data: edge.data ? { ...edge.data } : edge.data,
      };
      // Remap prompt references on agentTask edges
      if (newEdge.data?.prompt && isExpression(newEdge.data.prompt)) {
        const prompt = newEdge.data.prompt as Expression;
        newEdge.data = {
          ...newEdge.data,
          prompt: {
            ...prompt,
            references: prompt.references.map((ref) => ({
              srcId: idMap.get(ref.srcId) ?? ref.srcId,
              varId: ref.varId,
            })),
          },
        };
      }
      return newEdge;
    });

  // Deselect existing nodes before adding new ones
  setNodes((nds) => [...nds.map((n) => ({ ...n, selected: false })), ...newNodes]);
  setEdges((eds) => [...eds, ...newEdges]);

  // Add pasted nodes' variables to store
  setVariables((vars) => ({ ...vars, ...computeVariablesFromNodes(newNodes.map((n) => n.data)) }));

  return { pasted: true, skippedLabels };
}

// ============================================================================
// Expression Reference Updater (for paste)
// ============================================================================

/** Update expression references to point to new node IDs after paste */
function updateExpressionsInArgs(args: Record<string, unknown>, idMap: Map<string, string>): Record<string, unknown> {
  const updated: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (isExpression(value)) {
      // Update references with new node IDs
      const updatedExpr: Expression = {
        expression: value.expression,
        dataType: value.dataType,
        references: value.references.map((ref) => ({
          srcId: idMap.get(ref.srcId) ?? ref.srcId,
          varId: ref.varId,
        })),
      };
      updated[key] = updatedExpr;
    } else if (Array.isArray(value)) {
      // Handle arrays of expressions
      updated[key] = value.map((item) => {
        if (isExpression(item)) {
          return {
            expression: item.expression,
            dataType: item.dataType,
            references: item.references.map((ref) => ({
              srcId: idMap.get(ref.srcId) ?? ref.srcId,
              varId: ref.varId,
            })),
          };
        }
        return item;
      });
    } else if (value !== null && typeof value === "object") {
      // Handle nested objects
      updated[key] = updateExpressionsInArgs(value as Record<string, unknown>, idMap);
    } else {
      updated[key] = value;
    }
  }

  return updated;
}

// ============================================================================
// ReactFlow Type Resolution
// ============================================================================

/** Determine React Flow node type based on NodeCategory */
export function getReactFlowType(type: NodeType): string {
  if (type === "FunctionCall") {
    return "FunctionCall";
  }
  const category = NodeRegistry.getByType(type)?.category ?? "Uncategorized";
  switch (category) {
    case NodeCategory.Trigger:
    case NodeCategory.Tool:
    case NodeCategory.AI:
      return category;
    default:
      return "Standard";
  }
}
