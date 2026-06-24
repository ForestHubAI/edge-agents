import { useCallback } from "react";
import { serialize, deserialize, type ApiWorkflow, type Workflow, type Canvas } from "@foresthubai/workflow-core/workflow";
import { migrate } from "@foresthubai/workflow-core/migration";
import type { NodeData } from "@foresthubai/workflow-core/node";
import type { EdgeData } from "@foresthubai/workflow-core/edge";
import type { Channel } from "@foresthubai/workflow-core/channel";
import type { Memory } from "@foresthubai/workflow-core/memory";
import type { Model } from "@foresthubai/workflow-core/model";
import { Edge, Node } from "@xyflow/react";
import { clearAllCanvasStores, getOrCreateCanvasStore, getAllCanvasStores, notifyCanvasRegistryChange, MAIN_CANVAS_ID } from "../stores/canvasStore";
import { useEditorStore } from "../stores/editorStore";
import { getReactFlowType } from "../utils/graphOperations";

/**
 * Store-bound wrapper around the headless `serialize`/`deserialize` in
 * `@foresthubai/workflow-core/workflow`. All conversion logic lives in core;
 * this hook only mediates Zustand I/O.
 *
 * Core sets each node's outer `type` to the domain node type (e.g.
 * "Agent"); React Flow needs the *display* type — `getReactFlowType`
 * handles that on import.
 */
export function useWorkflowSerialization() {
  const importProject = useCallback((workflow: ApiWorkflow): void => {
    // Migrate at the load boundary so an older saved document is brought current
    // before deserialize ever sees it. A no-op on an already-current document.
    const state = deserialize(migrate(workflow));

    clearAllCanvasStores();

    // Bodies → canvas stores. The function declarations are already in domain shape
    // (FunctionDeclaration) on state.functions; the body is the canvas at the same id.
    for (const [canvasId, canvas] of Object.entries(state.canvases)) {
      const store = getOrCreateCanvasStore(canvasId);
      const rfNodes: Node<NodeData>[] = canvas.nodes.map((n) => ({
        id: n.id,
        type: getReactFlowType(n.type),
        position: n.position,
        data: n,
      }));
      const rfEdges: Edge<EdgeData>[] = canvas.edges.map((e) => ({
        id: e.id,
        type: e.type,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
        ...(e.data ? { data: e.data } : {}),
      }));
      store.getState().initialize(rfNodes, rfEdges);
      // `initialize` rebuilds node-output vars from the nodes. Replace with the
      // fully merged set core already computed (includes declared + fnarg).
      store.getState().setVariables(() => canvas.variables);
    }

    // Reconcile project-scoped resources to exactly what this workflow declares.
    // The editor stores are module-level and outlive the previously loaded project,
    // so a workflow that declares none of a given kind must still reset it —
    // otherwise the prior project's channels/memory/models bleed in (the canvas
    // stores get this for free via clearAllCanvasStores above, as does setFunctions).
    const { channels, memory, models } = state;
    useEditorStore.getState().setChannels(() => channels);
    useEditorStore.getState().setMemory(() => memory);
    useEditorStore.getState().setModels(() => models);
    useEditorStore.getState().setFunctions(() => state.functions);

    // The function canvas stores were created after clearAllCanvasStores' notify,
    // so tell WorkflowBuilder to re-subscribe to the new set.
    notifyCanvasRegistryChange();
  }, []);

  const exportProject = useCallback((): ApiWorkflow => {
    return serialize(readStateFromStores());
  }, []);

  // Inverse of importProject: reset every (module-level) store to empty so a fresh
  // builder never inherits the previously mounted project. Used by the clear() handle
  // and on mount when no initialWorkflow is supplied.
  const clearProject = useCallback((): void => {
    clearAllCanvasStores(); // drops all canvas stores, re-seeds an empty main, notifies
    const editor = useEditorStore.getState();
    // A stale non-main activeCanvasId would lazily resurrect a phantom function body.
    editor.setActiveCanvas(MAIN_CANVAS_ID);
    // Project-scoped resources aren't touched by clearAllCanvasStores. Empty only when
    // non-empty so an already-clean store doesn't bump mutationCount (as importProject).
    editor.setChannels((c) => (Object.keys(c).length ? {} : c));
    editor.setMemory((m) => (Object.keys(m).length ? {} : m));
    editor.setModels((m) => (Object.keys(m).length ? {} : m));
    editor.setFunctions((f) => (Object.keys(f).length ? {} : f));
    editor.clearSelection();
  }, []);

  return { exportProject, importProject, clearProject };
}

/**
 * Read the editor's live Zustand state into a {@link Workflow} literal.
 * Peels the React Flow wrapper without recomputing anything; channels and
 * memory files are unprefixed for the core shape.
 *
 * Exported so the imperative handle can pass live state to
 * `validateWorkflowState` without a serialize/deserialize round-trip.
 */
export function readStateFromStores(): Workflow {
  const canvases: Record<string, Canvas> = {};
  for (const [id, store] of Object.entries(getAllCanvasStores())) {
    const s = store.getState();
    canvases[id] = {
      nodes: s.nodes.map((n) => ({ ...n.data, position: n.position })),
      edges: s.edges.map((e) => ({
        id: e.id,
        type: e.type,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
        ...(e.data ? { data: e.data } : {}),
      })),
      variables: s.variables,
    };
  }

  const channels: Record<string, Channel> = {};
  for (const ch of Object.values(useEditorStore.getState().channels)) channels[ch.id] = ch;

  const memory: Record<string, Memory> = {};
  for (const m of Object.values(useEditorStore.getState().memory)) memory[m.id] = m;

  const models: Record<string, Model> = {};
  for (const m of Object.values(useEditorStore.getState().models)) models[m.id] = m;

  // Function declarations are project-scoped and already in domain shape; the body
  // for each is the canvas at the same id (above).
  return {
    canvases,
    functions: useEditorStore.getState().functions,
    channels,
    memory,
    models,
  };
}
