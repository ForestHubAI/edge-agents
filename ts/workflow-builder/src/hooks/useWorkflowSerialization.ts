import { useCallback } from "react";
import { serialize, deserialize, type ApiWorkflow, type Workflow, type Canvas } from "@foresthubai/workflow-core/workflow";
import { migrate } from "@foresthubai/workflow-core/migration";
import type { NodeData } from "@foresthubai/workflow-core/node";
import type { EdgeData } from "@foresthubai/workflow-core/edge";
import type { Channel } from "@foresthubai/workflow-core/channel";
import type { Memory } from "@foresthubai/workflow-core/memory";
import type { Model } from "@foresthubai/workflow-core/model";
import { Edge, Node } from "@xyflow/react";
import { clearAllCanvasStores, getOrCreateCanvasStore, getAllCanvasStores, notifyCanvasRegistryChange } from "../stores/canvasStore";
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

    const { channels, memory, models } = state;
    if (channels && Object.keys(channels).length > 0) {
      useEditorStore.getState().setChannels(() => channels);
    }
    if (memory && Object.keys(memory).length > 0) {
      useEditorStore.getState().setMemory(() => memory);
    }
    if (models && Object.keys(models).length > 0) {
      useEditorStore.getState().setModels(() => models);
    }
    // Replace the full function set (bodies are already initialized above, so the
    // migration subscription on setFunctions sees populated canvases).
    useEditorStore.getState().setFunctions(() => state.functions);

    // The function canvas stores were created after clearAllCanvasStores' notify,
    // so tell WorkflowBuilder to re-subscribe to the new set.
    notifyCanvasRegistryChange();
  }, []);

  const exportProject = useCallback((): ApiWorkflow => {
    return serialize(readStateFromStores());
  }, []);

  return { exportProject, importProject };
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
