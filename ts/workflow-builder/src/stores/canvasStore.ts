import { create, UseBoundStore, StoreApi } from "zustand";
import { Node, Edge } from "@xyflow/react";
import { NodeCategory, type NodeData } from "@foresthubai/workflow-core/node";
import type { FunctionInfo, Expression } from "@foresthubai/workflow-core";
import type { EdgeData } from "@foresthubai/workflow-core/edge";
import { history, History, type HistoryData, type MutationCount } from "../utils/history";
import { generateId } from "@foresthubai/workflow-core/id";
import { fnargKey, type Variable } from "@foresthubai/workflow-core/variable";
import { computeVariablesFromNodes } from "@foresthubai/workflow-core/workflow";

/**
 * OutputAssignments map return variable uid → Expression.
 * Keyed by the uid of the corresponding FunctionInfo.returns entry.
 */
export type OutputAssignments = Record<string, Expression>;

/**
 * Sync fnarg:* entries in variables to match the given functionInfo's arguments.
 * Removes stale fnarg entries and adds/updates current ones.
 */
export function syncFunctionArgVariables(store: CanvasStore, newFunctionInfo: FunctionInfo | null): void {
  store.getState().setVariables((vars) => {
    const updated = { ...vars };
    // Remove all existing fnarg entries
    for (const key of Object.keys(updated)) {
      if (key.startsWith("fnarg:")) delete updated[key];
    }
    // Add current args
    if (newFunctionInfo?.arguments) {
      for (const arg of newFunctionInfo.arguments) {
        updated[fnargKey(arg.uid)] = { kind: "fnarg", uid: arg.uid, name: arg.name, dataType: arg.dataType };
      }
    }
    return updated;
  });
}

export { MAIN_CANVAS_ID } from "@foresthubai/workflow-core/workflow";
import { MAIN_CANVAS_ID } from "@foresthubai/workflow-core/workflow";
const HISTORY_LIMIT = 50 as const;

// ============================================================================
// Function Info Change Notification System
// ============================================================================

// Listeners that get notified when any canvas's functionInfo changes
const functionInfoListeners = new Set<() => void>();

// Notify all listeners that a function info changed
function notifyFunctionInfoListeners(): void {
  functionInfoListeners.forEach((listener) => listener());
}

// Subscribe to function info changes across all canvases
export function subscribeFunctionInfoChanges(listener: () => void): () => void {
  functionInfoListeners.add(listener);
  return () => functionInfoListeners.delete(listener);
}

// Manually trigger notification (used after import, delete, etc.)
export function notifyFunctionRegistryChange(): void {
  notifyFunctionInfoListeners();
}

// ============================================================================
// Canvas Store Registry
// ============================================================================

// Registry - Module-level map of independent store instances
const canvasStores = new Map<string, CanvasStore>();

canvasStores.set(MAIN_CANVAS_ID, createCanvasStore()); // Always exists

export interface CanvasState {
  nodes: Node<NodeData>[];
  edges: Edge<EdgeData>[];
  // Unified variable record: node outputs (nodeId:outputId), declared (declared:uid), fn args (fnarg:uid)
  variables: Record<string, Variable>;
  // Function definition - only present for function canvases (null for main canvas)
  functionInfo: FunctionInfo | null;
  // Output expression assignments - maps return variable uid → Expression
  outputAssignments: OutputAssignments;

  setNodes: (updater: (nodes: Node<NodeData>[]) => Node<NodeData>[]) => void;
  setEdges: (updater: (edges: Edge<EdgeData>[]) => Edge<EdgeData>[]) => void;
  setVariables: (updater: (variables: Record<string, Variable>) => Record<string, Variable>) => void;
  setFunctionInfo: (updater: (info: FunctionInfo | null) => FunctionInfo | null) => void;
  setOutputAssignments: (updater: (assignments: OutputAssignments) => OutputAssignments) => void;
  /** Visual-only: set ReactFlow selected flag on nodes. No history, safe in read-only mode. */
  selectNodes: (nodeIds: string[]) => void;
  /** Visual-only: set ReactFlow selected flag on edges. No history, safe in read-only mode. */
  selectEdges: (edgeIds: string[]) => void;
  initialize: (
    nodes: Node<NodeData>[],
    edges: Edge<EdgeData>[],
    functionInfo?: FunctionInfo | null,
    outputAssignments?: OutputAssignments,
  ) => void;
}

// Canvas store is a Zustand store + history (undo/redo capabilities) + mutation count.
export type CanvasStore = UseBoundStore<StoreApi<CanvasState & MutationCount>> & History;

function createCanvasStore(): CanvasStore {
  // Create base store with history middleware
  const baseStore = create(
    history<CanvasState>({
      limit: HISTORY_LIMIT,
      partialize: (state) => ({
        nodes: state.nodes,
        edges: state.edges,
        variables: state.variables,
        functionInfo: state.functionInfo,
        outputAssignments: state.outputAssignments,
      }),
      equality: (before, after) =>
        before.nodes === after.nodes &&
        before.edges === after.edges &&
        before.variables === after.variables &&
        before.functionInfo === after.functionInfo &&
        before.outputAssignments === after.outputAssignments,
    })((set) => ({
      nodes: [],
      edges: [],
      variables: {},
      functionInfo: null,
      outputAssignments: {},

      setNodes: (updater) =>
        set((state) => {
          const next = updater(state.nodes);
          if (next === state.nodes) return state;
          return { nodes: next };
        }),

      setEdges: (updater) =>
        set((state) => {
          const next = updater(state.edges);
          if (next === state.edges) return state;
          return { edges: next };
        }),

      setVariables: (updater) =>
        set((state) => {
          const next = updater(state.variables);
          if (next === state.variables) return state;
          return { variables: next };
        }),

      setFunctionInfo: (updater) => {
        let changed = false;
        set((state) => {
          const next = updater(state.functionInfo);
          if (next === state.functionInfo) return state;
          changed = true;
          return { functionInfo: next };
        });
        // Notify registry of the change, but only when functionInfo actually moved.
        if (changed) notifyFunctionInfoListeners();
      },

      setOutputAssignments: (updater) =>
        set((state) => {
          const next = updater(state.outputAssignments);
          if (next === state.outputAssignments) return state;
          return { outputAssignments: next };
        }),

      selectNodes: (nodeIds) => {
        const idSet = new Set(nodeIds);
        set((state) => ({
          nodes: state.nodes.map((n) => {
            const shouldSelect = idSet.has(n.id);
            return n.selected === shouldSelect ? n : { ...n, selected: shouldSelect };
          }),
        }));
      },

      selectEdges: (edgeIds) => {
        const idSet = new Set(edgeIds);
        set((state) => ({
          edges: state.edges.map((e) => {
            const shouldSelect = idSet.has(e.id);
            return e.selected === shouldSelect ? e : { ...e, selected: shouldSelect };
          }),
        }));
      },

      initialize: (nodes, edges, functionInfo = null, outputAssignments = {}) => {
        // Build variables: node outputs + fnarg entries from functionInfo.
        // computeVariablesFromNodes is the core (NodeData[]) variant; peel
        // the React Flow wrapper at the call site.
        const vars: Record<string, Variable> = computeVariablesFromNodes(nodes.map((n) => n.data));
        if (functionInfo?.arguments) {
          for (const arg of functionInfo.arguments) {
            vars[fnargKey(arg.uid)] = { kind: "fnarg", uid: arg.uid, name: arg.name, dataType: arg.dataType };
          }
        }
        set({
          nodes,
          edges,
          variables: vars,
          functionInfo,
          outputAssignments,
        });
      },
    })),
  );

  // Bind history methods from state to CanvasStore object
  // This makes them accessible as store.undo() instead of store.getState().undo()
  const store = baseStore as unknown as CanvasStore;

  store.takeCheckpoint = () => baseStore.getState().takeCheckpoint();
  store.withCheckpoint = <R>(operation: () => R): R => baseStore.getState().withCheckpoint(operation);
  store.undo = () => baseStore.getState().undo();
  store.redo = () => baseStore.getState().redo();
  store.clearHistory = () => baseStore.getState().clearHistory();
  store.canUndo = () => baseStore.getState().canUndo();
  store.canRedo = () => baseStore.getState().canRedo();
  store.exportHistory = () => baseStore.getState().exportHistory();
  store.importHistory = (data: HistoryData) => baseStore.getState().importHistory(data);

  return store;
}

// ============================================================================
// Store Access API
// ============================================================================

// Get a canvas store by ID, or undefined if not exists
export function getCanvasStore(canvasId: string): CanvasStore | undefined {
  return canvasStores.get(canvasId);
}

// Get or create a canvas store by ID
// Non-main canvases (function canvases) are initialized with an OnFunctionCall node
export function getOrCreateCanvasStore(canvasId: string): CanvasStore {
  if (!canvasStores.has(canvasId)) {
    const store = createCanvasStore();

    // Initialize function canvases with OnFunctionCall trigger node
    if (canvasId !== MAIN_CANVAS_ID) {
      const nodeId = generateId();
      const initialNode: Node<NodeData> = {
        id: nodeId,
        type: NodeCategory.Trigger,
        position: { x: 100, y: 100 },
        data: {
          id: nodeId,
          type: "OnFunctionCall",
          arguments: {},
        } as NodeData,
      };
      store.getState().initialize([initialNode], []);
    }

    canvasStores.set(canvasId, store);
  }
  return canvasStores.get(canvasId)!;
}

// Get all canvas stores
export function getAllCanvasStores(): Record<string, CanvasStore> {
  const result: Record<string, CanvasStore> = {};
  canvasStores.forEach((store, id) => {
    result[id] = store;
  });
  return result;
}

// Delete a canvas store by ID. Cannot delete the main canvas.
export function deleteCanvasStore(canvasId: string): void {
  if (canvasId === MAIN_CANVAS_ID) return;
  canvasStores.delete(canvasId);
  notifyFunctionInfoListeners();
}

// Clear all canvas stores, including the main canvas.
export function clearAllCanvasStores(): void {
  canvasStores.clear();
  notifyFunctionInfoListeners();
}

/**
 * Remove canvas stores whose IDs are NOT in the given set.
 * Preserves existing store instances so that React components holding
 * references continue to receive updates via Zustand subscriptions.
 */
export function retainCanvasStores(idsToKeep: Set<string>): void {
  for (const id of [...canvasStores.keys()]) {
    if (!idsToKeep.has(id)) {
      canvasStores.delete(id);
    }
  }
}
