import { NodeDefinition, NodeInstance } from "@foresthub/workflow-core/types/node";
import { Connection, Edge, Node } from "@xyflow/react";
import type { EdgeInstance } from "@foresthub/workflow-core/types/edge";
import { useCallback } from "react";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../store/canvasStore";
import {
  addNodeToStore,
  type Clipboard,
  connectNodesInStore,
  deleteEdgesFromStore,
  deleteNodeFromStore,
  pasteToStore,
  updateEdgeInStore,
  updateNodeInStore,
} from "../utils/graphOperations";
import type { EdgeType } from "@foresthub/workflow-core/types/edge";
import { useNodeDefinitions } from "./useNodeDefinitions";

// Shared across all useGraph instances (one per canvas) so copy/paste works
// across canvas switches within a single builder session.
const clipboardRef: { current: Clipboard | null } = { current: null };

/**
 * Hook that provides graph management actions for a specific canvas.
 *
 * All mutations are:
 * - Gated by readOnly (no-op when true)
 * - Automatically wrapped in a history checkpoint (undo/redo)
 *
 * Callers don't need to worry about either concern.
 */
export const useGraph = (canvasId: string = MAIN_CANVAS_ID, readOnly: boolean = false) => {
  const canvasStore = getOrCreateCanvasStore(canvasId);
  const nodes = canvasStore((s) => s.nodes);
  const edges = canvasStore((s) => s.edges);
  const { withCheckpoint } = canvasStore;

  const { getNodeDefinition } = useNodeDefinitions();

  // Guarded checkpoint: skips when readOnly, otherwise wraps in undo history entry
  const guarded = useCallback(
    <R>(operation: () => R): R | undefined => {
      if (readOnly) return undefined;
      return withCheckpoint(operation);
    },
    [readOnly, withCheckpoint],
  );

  const addNode = useCallback(
    (nodeDef: NodeDefinition, position?: { x: number; y: number }) => {
      return guarded(() => addNodeToStore(canvasStore, nodeDef, position)) ?? null;
    },
    [canvasStore, guarded],
  );

  const updateNode = useCallback(
    (nodeId: string, updates: { arguments?: Record<string, unknown>; label?: string }) => {
      guarded(() => updateNodeInStore(canvasStore, nodeId, updates));
    },
    [canvasStore, guarded],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      guarded(() => deleteNodeFromStore(canvasStore, nodeId, getNodeDefinition));
    },
    [canvasStore, getNodeDefinition, guarded],
  );

  const onConnect = useCallback(
    (connection: Connection): EdgeType | false => {
      return guarded(() => connectNodesInStore(canvasStore, connection)) ?? false;
    },
    [canvasStore, guarded],
  );

  const updateEdge = useCallback(
    (edgeId: string, updates: Record<string, unknown>) => {
      guarded(() => updateEdgeInStore(canvasStore, edgeId, updates));
    },
    [canvasStore, guarded],
  );

  const deleteEdges = useCallback(
    (edgeIds: string[]) => {
      guarded(() => deleteEdgesFromStore(canvasStore, edgeIds));
    },
    [canvasStore, guarded],
  );

  // Batch delete nodes and edges as a single undo entry
  const deleteSelected = useCallback(
    (nodeIds: string[], edgeIds: string[]) => {
      if (nodeIds.length === 0 && edgeIds.length === 0) return;
      guarded(() => {
        for (const nodeId of nodeIds) deleteNodeFromStore(canvasStore, nodeId, getNodeDefinition);
        if (edgeIds.length > 0) deleteEdgesFromStore(canvasStore, edgeIds);
      });
    },
    [canvasStore, getNodeDefinition, guarded],
  );

  // Copy is read-only — no checkpoint, no readOnly gate
  const copySelection = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) return;

      const nodeIdSet = new Set(nodeIds);

      const copiedNodes = nodes
        .filter((node) => nodeIdSet.has(node.id))
        .map((node) => JSON.parse(JSON.stringify(node)) as Node<NodeInstance>);

      const copiedEdges = edges
        .filter((edge) => nodeIdSet.has(edge.source) && nodeIdSet.has(edge.target))
        .map((edge) => JSON.parse(JSON.stringify(edge)) as Edge<EdgeInstance>);

      clipboardRef.current = { nodes: copiedNodes, edges: copiedEdges };
    },
    [nodes, edges],
  );

  const pasteSelection = useCallback(
    (offset?: { x: number; y: number }) => {
      const clipboard = clipboardRef.current;
      if (!clipboard) return undefined;
      return guarded(() => pasteToStore(canvasStore, clipboard, offset, getNodeDefinition));
    },
    [canvasStore, getNodeDefinition, guarded],
  );

  // Batch add node + connect as a single undo entry (used by contextual node picker)
  const addNodeAndConnect = useCallback(
    (nodeDef: NodeDefinition, position: { x: number; y: number }, connection: Connection): string | null => {
      return (
        guarded(() => {
          const nodeId = addNodeToStore(canvasStore, nodeDef, position);
          if (nodeId == null) return null;
          connectNodesInStore(canvasStore, { ...connection, target: nodeId });
          return nodeId;
        }) ?? null
      );
    },
    [canvasStore, guarded],
  );

  return {
    nodes,
    edges,
    addNode,
    updateNode,
    updateEdge,
    deleteNode,
    deleteEdges,
    deleteSelected,
    onConnect,
    addNodeAndConnect,
    copySelection,
    pasteSelection,
  };
};
