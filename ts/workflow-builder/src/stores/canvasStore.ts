import { create, UseBoundStore, StoreApi } from "zustand";
import { Node, Edge } from "@xyflow/react";
import { NodeCategory, type NodeData } from "@foresthubai/workflow-core/node";
import type { EdgeData } from "@foresthubai/workflow-core/edge";
import { history, History, type HistoryData, type MutationCount } from "../utils/history";
import { generateId } from "@foresthubai/workflow-core/id";
import { fnargKey, type Variable, type ApiVariable } from "@foresthubai/workflow-core/variable";
import { computeVariablesFromNodes } from "@foresthubai/workflow-core/workflow";

/**
 * Sync fnarg:* entries in a canvas's variables to match a function's arguments.
 * fnarg variables are *derived* from the (project-scoped) function declaration —
 * they are not authored canvas state, so the source of truth is `editorStore`;
 * callers pass the declaration's argument list here. Removes stale fnarg entries
 * and adds the current ones.
 */
export function syncFunctionArgVariables(store: CanvasStore, args: readonly ApiVariable[]): void {
  store.getState().setVariables((vars) => {
    const updated = { ...vars };
    // Remove all existing fnarg entries
    for (const key of Object.keys(updated)) {
      if (key.startsWith("fnarg:")) delete updated[key];
    }
    // Add current args
    for (const arg of args) {
      updated[fnargKey(arg.uid)] = { kind: "fnarg", uid: arg.uid, name: arg.name, dataType: arg.dataType };
    }
    return updated;
  });
}

export { MAIN_CANVAS_ID } from "@foresthubai/workflow-core/workflow";
import { MAIN_CANVAS_ID } from "@foresthubai/workflow-core/workflow";
const HISTORY_LIMIT = 50 as const;

// ============================================================================
// Canvas Registry Change Notification System
// ============================================================================

// Listeners notified when the *set* of canvas stores changes (a store is created,
// deleted, or the whole registry is cleared/retained). This is decoupled from
// function definitions — those now live in editorStore. Its sole consumer is
// WorkflowBuilder, which re-subscribes to every live store's mutationCount/history
// when the set changes so newly created (or dropped) canvases are watched.
const canvasRegistryListeners = new Set<() => void>();

// Notify subscribers that the canvas store set changed.
export function notifyCanvasRegistryChange(): void {
  canvasRegistryListeners.forEach((listener) => listener());
}

// Subscribe to canvas registry (store set) changes.
export function subscribeCanvasRegistryChanges(listener: () => void): () => void {
  canvasRegistryListeners.add(listener);
  return () => canvasRegistryListeners.delete(listener);
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
  // Unified variable record: node outputs (nodeId:outputId), declared (declared:uid), fn args (fnarg:uid).
  // fnarg:* entries are derived from the project-scoped function declaration (editorStore) via
  // syncFunctionArgVariables — they are not authored here.
  variables: Record<string, Variable>;

  setNodes: (updater: (nodes: Node<NodeData>[]) => Node<NodeData>[]) => void;
  setEdges: (updater: (edges: Edge<EdgeData>[]) => Edge<EdgeData>[]) => void;
  setVariables: (updater: (variables: Record<string, Variable>) => Record<string, Variable>) => void;
  /**
   * Visual-only: set ReactFlow selected flags on nodes AND edges in one atomic update.
   * This will call a single re-render and a single onSelectionChange callback.
   * Not an update of domain state, so it can be used in read-only mode.
   */
  setRFselect: (nodeIds: string[], edgeIds: string[]) => void;
  initialize: (nodes: Node<NodeData>[], edges: Edge<EdgeData>[]) => void;
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
      }),
      equality: (before, after) => before.nodes === after.nodes && before.edges === after.edges && before.variables === after.variables,
    })((set) => ({
      nodes: [],
      edges: [],
      variables: {},

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

      setRFselect: (nodeIds, edgeIds) => {
        const nodeIdSet = new Set(nodeIds);
        const edgeIdSet = new Set(edgeIds);
        set((state) => ({
          nodes: state.nodes.map((n) => {
            const shouldSelect = nodeIdSet.has(n.id);
            return n.selected === shouldSelect ? n : { ...n, selected: shouldSelect };
          }),
          edges: state.edges.map((e) => {
            const shouldSelect = edgeIdSet.has(e.id);
            return e.selected === shouldSelect ? e : { ...e, selected: shouldSelect };
          }),
        }));
      },

      initialize: (nodes, edges) => {
        // Build node-output variables. fnarg entries (for function canvases) are
        // seeded separately via syncFunctionArgVariables from the editorStore
        // declaration, since the canvas store no longer owns the signature.
        // computeVariablesFromNodes is the core (NodeData[]) variant; peel the
        // React Flow wrapper at the call site.
        const vars: Record<string, Variable> = computeVariablesFromNodes(nodes.map((n) => n.data));
        set({ nodes, edges, variables: vars });
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
  notifyCanvasRegistryChange();
}

// Clear all canvas stores, including the main canvas.
export function clearAllCanvasStores(): void {
  canvasStores.clear();
  // Re-seed an empty main canvas BEFORE notifying. Two reasons: it preserves the
  // "main always exists" invariant, and — critically — subscribers re-subscribe to
  // the live store set on this notification. If main were absent here, they'd
  // snapshot an empty registry and never attach to the lazily-recreated main, so
  // edits after New/clear wouldn't fire onChange (no dirty dot, stale undo state).
  canvasStores.set(MAIN_CANVAS_ID, createCanvasStore());
  notifyCanvasRegistryChange();
}
