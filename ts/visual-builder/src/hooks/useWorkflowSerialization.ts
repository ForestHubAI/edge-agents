import { useCallback } from "react";
import type { Schemas } from "@foresthub/workflow-core";
import { serialize, deserialize, type WorkflowState, type CanvasData } from "@foresthub/workflow-core/workflow";
import type { NodeInstance } from "@foresthub/workflow-core/node";
import type { EdgeInstance } from "@foresthub/workflow-core/edge";
import type { ChannelInstance } from "@foresthub/workflow-core/channel";
import type { MemoryFileInstance } from "@foresthub/workflow-core/memory";
import { Edge, Node } from "@xyflow/react";
import {
  clearAllCanvasStores,
  getOrCreateCanvasStore,
  getAllCanvasStores,
  notifyFunctionRegistryChange,
} from "../store/canvasStore";
import { useEditorStore } from "../store/editorStore";
import { getReactFlowType } from "../utils/graphOperations";
import { channelKey } from "../utils/channels";
import { memoryFileKey } from "../utils/memoryFiles";

/**
 * Store-bound wrapper around the headless `serialize`/`deserialize` in
 * `@foresthub/workflow-core/workflow`. All conversion logic lives in core;
 * this hook only mediates Zustand I/O.
 *
 * Two translation responsibilities the editor owns:
 *  - Core sets each node's outer `type` to the domain node type (e.g.
 *    "Agent"); React Flow needs the *display* type — `getReactFlowType`
 *    handles that on import.
 *  - Core's `WorkflowState.channels`/`memoryFiles` are keyed by plain
 *    `id`/`uid`; the editor's stores prefix them (`ch:`, `mem:`). Rekey
 *    on import; unprefix on export.
 *
 * Used for code generation, template loading, and (in the future) the
 * auto-save / version paths — one persistence format throughout.
 */
export function useWorkflowSerialization() {
  const importProject = useCallback((workflow: Schemas["Workflow"]): void => {
    const state = deserialize(workflow);

    clearAllCanvasStores();

    for (const [canvasId, canvas] of Object.entries(state.canvases)) {
      const store = getOrCreateCanvasStore(canvasId);
      const rfNodes: Node<NodeInstance>[] = canvas.nodes.map((n) => ({
        id: n.id,
        type: getReactFlowType(n.data.type),
        position: n.position,
        data: n.data,
      }));
      const rfEdges: Edge<EdgeInstance>[] = canvas.edges.map((e) => ({
        id: e.id,
        type: e.type,
        source: e.source,
        sourceHandle: e.sourceHandle,
        target: e.target,
        targetHandle: e.targetHandle,
        ...(e.data ? { data: e.data } : {}),
      }));
      store.getState().initialize(rfNodes, rfEdges, canvas.functionInfo, canvas.outputAssignments);
      // `initialize` rebuilds node-output + fnarg vars from the inputs. Replace
      // with the fully merged set core already computed (includes declared).
      store.getState().setVariables(() => canvas.variables);
    }

    if (state.channels && Object.keys(state.channels).length > 0) {
      const rekeyed: Record<string, ChannelInstance> = {};
      for (const ch of Object.values(state.channels)) rekeyed[channelKey(ch.id)] = ch;
      useEditorStore.getState().setChannels(() => rekeyed);
    }

    if (state.memoryFiles && Object.keys(state.memoryFiles).length > 0) {
      const rekeyed: Record<string, MemoryFileInstance> = {};
      for (const m of Object.values(state.memoryFiles)) rekeyed[memoryFileKey(m.uid)] = m;
      useEditorStore.getState().setMemoryFiles(() => rekeyed);
    }

    notifyFunctionRegistryChange();
  }, []);

  const exportProject = useCallback((): Schemas["Workflow"] => {
    return serialize(readStateFromStores());
  }, []);

  return { exportProject, importProject };
}

/**
 * Read the editor's live Zustand state into a {@link WorkflowState} literal.
 * Peels the React Flow wrapper without recomputing anything; channels and
 * memory files are unprefixed for the core shape.
 *
 * Exported so the imperative handle can pass live state to
 * `validateWorkflowState` without a serialize/deserialize round-trip.
 */
export function readStateFromStores(): WorkflowState {
  const canvases: Record<string, CanvasData> = {};
  for (const [id, store] of Object.entries(getAllCanvasStores())) {
    const s = store.getState();
    canvases[id] = {
      nodes: s.nodes.map((n) => ({
        id: n.id,
        type: n.data.type,
        position: n.position,
        data: n.data,
      })),
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
      functionInfo: s.functionInfo,
      outputAssignments: s.outputAssignments,
    };
  }

  const channels: Record<string, ChannelInstance> = {};
  for (const ch of Object.values(useEditorStore.getState().channels)) channels[ch.id] = ch;

  const memoryFiles: Record<string, MemoryFileInstance> = {};
  for (const m of Object.values(useEditorStore.getState().memoryFiles)) memoryFiles[m.uid] = m;

  return {
    canvases,
    ...(Object.keys(channels).length > 0 ? { channels } : {}),
    ...(Object.keys(memoryFiles).length > 0 ? { memoryFiles } : {}),
  };
}
