import { useCallback, useMemo } from "react";
import type { NodeData, NodeDefinition } from "@foresthub/workflow-core/node";
import type { EdgeData, EdgeType } from "@foresthub/workflow-core/edge";
import { isControlFlow } from "@foresthub/workflow-core/edge";
import type { NodeCategory as NodeCategoryEnum } from "@foresthub/workflow-core/node";

import { ChannelConfigPanel } from "./panels/ChannelConfigPanel";
import { DebugExternalIOPanel } from "./panels/DebugExternalIOPanel";
import { EdgeConfigPanel } from "./panels/EdgeConfigPanel";
import { MemoryConfigPanel } from "./panels/MemoryConfigPanel";
import { ModelConfigPanel } from "./panels/ModelConfigPanel";
import { NodeConfigPanel } from "./panels/NodeConfigPanel";
import { VariableConfigPanel } from "./panels/VariableConfigPanel";
import { getOrCreateCanvasStore } from "./stores/canvasStore";
import { useEditorStore } from "./stores/editorStore";
import { declaredVarKey } from "@foresthub/workflow-core/variable";

/**
 * Right-side selection-routed config panel.
 *
 * Reads the current selection from editorStore (project-wide) and the
 * selected node/edge from the active canvas store, then renders the
 * appropriate config component. Receives graph mutation handlers from
 * BuilderLayout — it never touches the canvas store directly for writes.
 *
 * Hidden while the user is mid selection-drag to avoid flicker.
 */
export interface RightConfigPanelProps {
  canvasId: string;
  isDebugMode: boolean;
  selectionDrag: boolean;

  // Lookups
  getNodeDef: (node: NodeData) => NodeDefinition | undefined;

  // Mutation handlers (live in BuilderLayout, bound to active canvas)
  onNodeUpdate: (nodeId: string, updates: Partial<NodeData>) => void;
  onNodeDelete: (nodeId: string) => void;
  onEdgeUpdate: (edgeId: string, updates: Partial<EdgeData>) => void;
  onEdgeDelete: (edgeId: string) => void;
  onClearSelection: () => void;

  // Embedder-fulfilled
  onTestNode?: (nodeId: string) => void;
  onDebugStep?: (nodeId?: string) => void;
}

export const RightConfigPanel = ({
  canvasId,
  isDebugMode,
  selectionDrag,
  getNodeDef,
  onNodeUpdate,
  onNodeDelete,
  onEdgeUpdate,
  onEdgeDelete,
  onClearSelection,
  onTestNode,
  onDebugStep,
}: RightConfigPanelProps) => {
  const selectedNodeIds = useEditorStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useEditorStore((s) => s.selectedEdgeIds);
  const selectedChannelId = useEditorStore((s) => s.selectedChannelId);
  const channels = useEditorStore((s) => s.channels);
  const setSelectedChannelId = useEditorStore((s) => s.setSelectedChannelId);
  const selectedMemoryId = useEditorStore((s) => s.selectedMemoryId);
  const memory = useEditorStore((s) => s.memory);
  const setSelectedMemoryId = useEditorStore((s) => s.setSelectedMemoryId);
  const selectedModelId = useEditorStore((s) => s.selectedModelId);
  const models = useEditorStore((s) => s.models);
  const setSelectedModelId = useEditorStore((s) => s.setSelectedModelId);
  const selectedVariableUid = useEditorStore((s) => s.selectedVariableUid);
  const setSelectedVariableUid = useEditorStore((s) => s.setSelectedVariableUid);

  const useStore = getOrCreateCanvasStore(canvasId);

  const selectedNode = useStore(
    useCallback(
      (s) => {
        if (selectedNodeIds.length !== 1) return null;
        const node = s.nodes.find((n) => n.id === selectedNodeIds[0]);
        return node?.data ?? null;
      },
      [selectedNodeIds],
    ),
  );

  const selectedVariable = useStore(
    useCallback(
      (s) => {
        if (!selectedVariableUid) return null;
        const v = s.variables[declaredVarKey(selectedVariableUid)];
        return v && v.kind === "declared" ? v : null;
      },
      [selectedVariableUid],
    ),
  );

  const selectedEdgeRaw = useStore(
    useCallback(
      (s) => {
        if (selectedEdgeIds.length !== 1 || selectedNodeIds.length > 0) return null;
        return s.edges.find((e) => e.id === selectedEdgeIds[0]) ?? null;
      },
      [selectedEdgeIds, selectedNodeIds],
    ),
  );
  const selectedEdge = selectedEdgeRaw
    ? {
        id: selectedEdgeRaw.id,
        source: selectedEdgeRaw.source,
        type: (selectedEdgeRaw.type ?? "control") as EdgeType,
        data: (selectedEdgeRaw.data ?? {}) as EdgeData,
      }
    : null;

  const sourceControlEdgeCount = useStore(
    useCallback(
      (s) => {
        if (!selectedEdge) return 0;
        return s.edges.filter((e) => e.source === selectedEdge.source && isControlFlow(e.type as EdgeType)).length;
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [selectedEdge?.source],
    ),
  );

  const selectedChannel = useMemo(
    () => (selectedChannelId ? (Object.values(channels).find((v) => v.id === selectedChannelId) ?? null) : null),
    [selectedChannelId, channels],
  );

  const selectedMemory = useMemo(
    () => (selectedMemoryId ? (Object.values(memory).find((m) => m.id === selectedMemoryId) ?? null) : null),
    [selectedMemoryId, memory],
  );

  const selectedModel = useMemo(
    () => (selectedModelId ? (Object.values(models).find((m) => m.id === selectedModelId) ?? null) : null),
    [selectedModelId, models],
  );

  const getNodeCategory = useCallback(
    (node: NodeData) => getNodeDef(node)?.category as NodeCategoryEnum | undefined,
    [getNodeDef],
  );

  const handleTestNode = useCallback((nodeId: string) => onTestNode?.(nodeId), [onTestNode]);

  if (selectionDrag) return null;

  if (isDebugMode) {
    if (!selectedNode) return null;
    return (
      <div className="w-80 border-l border-border bg-background overflow-y-auto p-3">
        <DebugExternalIOPanel
          canvasId={canvasId}
          onStep={onDebugStep ?? (() => {})}
          getNodeCategory={getNodeCategory}
        />
      </div>
    );
  }

  if (selectedNode) {
    return (
      <div className="w-80 border-l border-border bg-card overflow-y-auto">
        <NodeConfigPanel
          canvasId={canvasId}
          selectedNode={selectedNode}
          onNodeUpdate={onNodeUpdate}
          onNodeDelete={onNodeDelete}
          onClose={onClearSelection}
          onOpenTest={handleTestNode}
          getNodeDef={getNodeDef}
        />
      </div>
    );
  }

  if (selectedEdge) {
    return (
      <div className="w-80 border-l border-border bg-card overflow-y-auto">
        <EdgeConfigPanel
          canvasId={canvasId}
          edgeId={selectedEdge.id}
          edgeType={selectedEdge.type}
          edgeData={selectedEdge.data}
          sourceControlEdgeCount={sourceControlEdgeCount}
          onEdgeUpdate={onEdgeUpdate}
          onEdgeDelete={onEdgeDelete}
          onClose={onClearSelection}
        />
      </div>
    );
  }

  if (selectedVariable) {
    return (
      <div className="w-80 border-l border-border bg-card overflow-y-auto">
        <VariableConfigPanel
          canvasId={canvasId}
          variable={selectedVariable}
          onClose={() => setSelectedVariableUid(null)}
        />
      </div>
    );
  }

  if (selectedChannel) {
    return (
      <div className="w-80 border-l border-border bg-card overflow-y-auto">
        <ChannelConfigPanel channel={selectedChannel} onClose={() => setSelectedChannelId(null)} />
      </div>
    );
  }

  if (selectedMemory) {
    return (
      <div className="w-80 border-l border-border bg-card overflow-y-auto">
        <MemoryConfigPanel memory={selectedMemory} onClose={() => setSelectedMemoryId(null)} />
      </div>
    );
  }

  if (selectedModel) {
    return (
      <div className="w-80 border-l border-border bg-card overflow-y-auto">
        <ModelConfigPanel model={selectedModel} onClose={() => setSelectedModelId(null)} />
      </div>
    );
  }

  return null;
};
