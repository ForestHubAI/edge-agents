// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { useCallback, useMemo, type ReactNode } from "react";
import type { NodeData, NodeDefinition } from "@foresthubai/workflow-core/node";
import type { EdgeData, EdgeType } from "@foresthubai/workflow-core/edge";
import { isControlFlow } from "@foresthubai/workflow-core/edge";
import type { NodeCategory as NodeCategoryEnum } from "@foresthubai/workflow-core/node";

import { ScrollArea } from "./components/ui/scroll-area";
import { cn } from "./cn";
import { ChannelConfigPanel } from "./panels/ChannelConfigPanel";
import { DebugExternalIOPanel } from "./panels/DebugExternalIOPanel";
import { EdgeConfigPanel } from "./panels/EdgeConfigPanel";
import { FunctionConfigPanel } from "./panels/FunctionConfigPanel";
import { MemoryConfigPanel } from "./panels/MemoryConfigPanel";
import { ModelConfigPanel } from "./panels/ModelConfigPanel";
import { NodeConfigPanel } from "./panels/NodeConfigPanel";
import { VariableConfigPanel } from "./panels/VariableConfigPanel";
import { getOrCreateCanvasStore } from "./stores/canvasStore";
import { useEditorStore } from "./stores/editorStore";
import { declaredVarKey } from "@foresthubai/workflow-core/variable";

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
  const selection = useEditorStore((s) => s.selection);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const channels = useEditorStore((s) => s.channels);
  const memory = useEditorStore((s) => s.memory);
  const models = useEditorStore((s) => s.models);
  const functions = useEditorStore((s) => s.functions);

  const useStore = getOrCreateCanvasStore(canvasId);

  const selectedNode = useStore(
    useCallback(
      (s) => {
        if (selection.kind !== "graph" || selection.nodeIds.length !== 1) return null;
        const node = s.nodes.find((n) => n.id === selection.nodeIds[0]);
        return node?.data ?? null;
      },
      [selection],
    ),
  );

  const selectedVariable = useStore(
    useCallback(
      (s) => {
        if (selection.kind !== "variable") return null;
        const v = s.variables[declaredVarKey(selection.uid)];
        return v && v.kind === "declared" ? v : null;
      },
      [selection],
    ),
  );

  const selectedEdgeRaw = useStore(
    useCallback(
      (s) => {
        // Edge panel shows only for a lone edge (a node selection takes priority).
        if (selection.kind !== "graph" || selection.edgeIds.length !== 1 || selection.nodeIds.length > 0) return null;
        return s.edges.find((e) => e.id === selection.edgeIds[0]) ?? null;
      },
      [selection],
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
    () => (selection.kind === "channel" ? (Object.values(channels).find((v) => v.id === selection.id) ?? null) : null),
    [selection, channels],
  );

  const selectedMemory = useMemo(
    () => (selection.kind === "memory" ? (Object.values(memory).find((m) => m.id === selection.id) ?? null) : null),
    [selection, memory],
  );

  const selectedModel = useMemo(
    () => (selection.kind === "model" ? (Object.values(models).find((m) => m.id === selection.id) ?? null) : null),
    [selection, models],
  );

  const selectedFunction = useMemo(
    () => (selection.kind === "function" ? (functions[selection.id] ?? null) : null),
    [selection, functions],
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
      <Shell bg="bg-background" pad>
        <DebugExternalIOPanel
          canvasId={canvasId}
          onStep={onDebugStep ?? (() => {})}
          getNodeCategory={getNodeCategory}
        />
      </Shell>
    );
  }

  if (selectedNode) {
    return (
      <Shell>
        <NodeConfigPanel
          canvasId={canvasId}
          selectedNode={selectedNode}
          onNodeUpdate={onNodeUpdate}
          onNodeDelete={onNodeDelete}
          onClose={onClearSelection}
          onOpenTest={handleTestNode}
          getNodeDef={getNodeDef}
        />
      </Shell>
    );
  }

  if (selectedEdge) {
    return (
      <Shell>
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
      </Shell>
    );
  }

  if (selectedVariable) {
    return (
      <Shell>
        <VariableConfigPanel
          canvasId={canvasId}
          variable={selectedVariable}
          onClose={clearSelection}
        />
      </Shell>
    );
  }

  if (selectedChannel) {
    return (
      <Shell>
        <ChannelConfigPanel channel={selectedChannel} onClose={clearSelection} />
      </Shell>
    );
  }

  if (selectedMemory) {
    return (
      <Shell>
        <MemoryConfigPanel memory={selectedMemory} onClose={clearSelection} />
      </Shell>
    );
  }

  if (selectedModel) {
    return (
      <Shell>
        <ModelConfigPanel model={selectedModel} onClose={clearSelection} />
      </Shell>
    );
  }

  if (selectedFunction) {
    return (
      <Shell>
        <FunctionConfigPanel func={selectedFunction} onClose={clearSelection} />
      </Shell>
    );
  }

  return null;
};

/**
 * Right-panel chrome — fixed-width column with the bordered card background
 * and an overlay scrollbar. Extracted because all eight selection branches
 * render the same shell; keeping them in lockstep by hand was an obvious
 * drift risk. The debug variant overrides the surface and adds inner padding
 * (other variants pad inside their own ConfigPanel).
 */
const Shell = ({
  bg = "bg-card",
  pad = false,
  children,
}: {
  bg?: string;
  pad?: boolean;
  children: ReactNode;
}) => (
  <ScrollArea className={cn("w-80 border-l border-border", bg)} viewportClassName={pad ? "p-3" : undefined}>
    {children}
  </ScrollArea>
);
