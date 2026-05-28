import type { FunctionDeclaration } from "@foresthubai/workflow-core/function";
import type { NodeDefinition } from "@foresthubai/workflow-core/node";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Connection, OnSelectionChangeFunc } from "@xyflow/react";

import { toast } from "./hooks/use-toast";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import { BuilderSidebar } from "./panels/BuilderSidebar";
import { CanvasTabsToolbar } from "./toolbars/CanvasTabsToolbar";
import { CanvasEditor } from "./CanvasEditor";
import { RightConfigPanel } from "./RightConfigPanel";
import { useCanvasHistory } from "./hooks/useCanvasHistory";
import { useGraph } from "./hooks/useGraph";
import { useNodeDefinitions } from "./hooks/useNodeDefinitions";
import { DebugConsolePanel } from "./panels/DebugConsolePanel";
import type { CanvasTab } from "./hooks/useCanvasTabs";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "./stores/canvasStore";
import { useEditorStore } from "./stores/editorStore";
import { isReadOnly } from "./WorkflowBuilder";

/**
 * Chrome composer. Stable across canvas switches — only the {@link CanvasEditor}
 * child remounts via `key={activeCanvasId}`.
 *
 * Owns:
 *  - Sidebar tab state and the mode → sidebar-tab auto-switch effect.
 *  - viewportCenterRef (populated by ReactFlow, consumed by sidebar's
 *    click-to-add path).
 *  - Selection-drag flag (lifted here so RightConfigPanel can read it).
 *  - All graph mutation handlers — bound to active canvas via
 *    `useGraph(activeCanvasId)`. Handlers stay stable enough to pass to the
 *    sidebar; closures refresh automatically when the active canvas changes.
 *  - Document-level keyboard handlers (undo/redo/copy/paste/delete/escape).
 *
 * Receives the open-tab list and function-CRUD callbacks from
 * {@link WorkflowBuilder} above (which owns long-lived editor state).
 */
export interface BuilderLayoutProps {
  functions: FunctionDeclaration[];
  /** Open (and select) an existing function — used by the sidebar list and tab dropdown. */
  onOpenFunction: (functionId: string) => void;
  /** Create a new function and open it — the sidebar list's "Add" action. */
  onCreateFunction: () => string;

  canvasTabs: CanvasTab[];
  onCanvasTabChange: (tabId: string) => void;
  onCanvasTabClose: (tabId: string) => void;
  onCanvasTabReorder: (fromIndex: number, toIndex: number) => void;

  onTestNode?: (nodeId: string) => void;
  onDebugStep?: (nodeId?: string) => void;
}

export const BuilderLayout = ({
  functions,
  onOpenFunction,
  onCreateFunction,
  canvasTabs,
  onCanvasTabChange,
  onCanvasTabClose,
  onCanvasTabReorder,
  onTestNode,
  onDebugStep,
}: BuilderLayoutProps) => {
  const activeCanvasId = useEditorStore((s) => s.activeCanvasId);
  const builderMode = useEditorStore((s) => s.builderMode);
  const readOnly = isReadOnly(builderMode);
  const isDebugMode = builderMode.type === "debug";

  // NodeRegistry (static) + dynamic function nodes — derived, not embedder-provided.
  const { nodeDefinitions, getNodeDefinition, getAllCategories } = useNodeDefinitions();

  const graph = useGraph(activeCanvasId, readOnly);
  const { undo, redo, takeCheckpoint, canUndo, canRedo } = useCanvasHistory(activeCanvasId);

  // Selection (project-wide in editorStore, mirrored to canvas store for RF visual)
  const selection = useEditorStore((s) => s.selection);
  const selectGraph = useEditorStore((s) => s.selectGraph);
  const syncSelectionFromRF = useEditorStore((s) => s.syncSelectionFromRF);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  // Sidebar tab state + mode auto-switch.
  const activeSidebarTab = useEditorStore((s) => s.activeSidebarTab);
  const setActiveSidebarTab = useEditorStore((s) => s.setActiveSidebarTab);
  useEffect(() => {
    const isDebugTab = activeSidebarTab === "debug-context";
    if (isDebugMode && !isDebugTab) {
      setActiveSidebarTab("debug-context");
    } else if (!isDebugMode && isDebugTab) {
      setActiveSidebarTab("nodes");
    }
  }, [isDebugMode, activeSidebarTab, setActiveSidebarTab]);

  // Selection-drag flag (used by RightConfigPanel to suppress during drag).
  const [selectionDrag, setSelectionDrag] = useState(false);

  // ViewportCenter ref (populated by ReactFlow inside CanvasEditor, consumed
  // here for sidebar's click-to-add path).
  const viewportCenterRef = useRef<(() => { x: number; y: number }) | null>(null);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const selectNodeById: (id: string) => void = useCallback(
    (nodeId: string) => selectGraph([nodeId], []),
    [selectGraph],
  );

  const selectEdgeById = useCallback((edgeId: string) => selectGraph([], [edgeId]), [selectGraph]);

  const handleAddNode = useCallback(
    (nodeDef: NodeDefinition, position?: { x: number; y: number }) => {
      const pos = position ?? viewportCenterRef.current?.();
      const id = graph.addNode(nodeDef, pos);
      if (id == null) {
        toast({ title: `Only one ${nodeDef.label} node allowed per canvas`, variant: "destructive" });
      }
      return id;
    },
    [graph],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      const edgeType = graph.onConnect(conn);
      // Auto-select agent edges so the config panel opens for parameter entry.
      if (edgeType && edgeType !== "control" && edgeType !== "tool") {
        const { edges: currentEdges } = getOrCreateCanvasStore(activeCanvasId).getState();
        const newEdge = currentEdges.find(
          (e) =>
            e.source === conn.source &&
            e.target === conn.target &&
            e.sourceHandle === conn.sourceHandle &&
            e.targetHandle === conn.targetHandle,
        );
        if (newEdge) selectEdgeById(newEdge.id);
      }
    },
    [graph, activeCanvasId, selectEdgeById],
  );

  const handleAddNodeAndConnect = useCallback(
    (
      nodeDef: NodeDefinition,
      position: { x: number; y: number },
      connection: { source: string; sourceHandle: string; target: string; targetHandle: string },
    ) => {
      const newNodeId = graph.addNodeAndConnect(nodeDef, position, connection);
      if (newNodeId == null) {
        toast({ title: `Only one ${nodeDef.label} node allowed per canvas`, variant: "destructive" });
      }
      return newNodeId;
    },
    [graph],
  );

  const handleSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selNodes, edges: selEdges }) => {
      syncSelectionFromRF(
        selNodes.map((n) => n.id),
        selEdges.map((e) => e.id),
      );
    },
    [syncSelectionFromRF],
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      graph.deleteEdges([edgeId]);
      clearSelection();
    },
    [graph, clearSelection],
  );

  const handleNodeDragStart = useCallback(() => {
    takeCheckpoint();
  }, [takeCheckpoint]);

  const deleteSelected = useCallback(() => {
    const sel = useEditorStore.getState().selection;
    const nodeIds = sel.kind === "graph" ? sel.nodeIds : [];
    const edgeIds = sel.kind === "graph" ? sel.edgeIds : [];
    graph.deleteSelected(nodeIds, edgeIds);
    clearSelection();
  }, [graph, clearSelection]);

  const handlePaste = useCallback(
    (offset?: { x: number; y: number }) => {
      const result = graph.pasteSelection(offset);
      if (result?.skippedLabels.length) {
        for (const label of result.skippedLabels) {
          toast({ title: `Only one ${label} node allowed per canvas`, variant: "destructive" });
        }
      }
      return result;
    },
    [graph],
  );

  // Debug mode: clicking a node sets the debug cursor.
  // useEffect(() => {
  //   if (!isDebugMode || selectedNodeIds.length !== 1) return;
  //   const nodeId = selectedNodeIds[0];
  //   const phase = useDebugStore.getState().phase;
  //   if (phase.status === "idle") {
  //     useDebugStore
  //       .getState()
  //       .setPhase({ status: "paused", sessionId: phase.sessionId, cursorNodeId: nodeId });
  //   } else if (phase.status === "paused") {
  //     useDebugStore.getState().setPhase({ ...phase, cursorNodeId: nodeId });
  //   }
  // }, [isDebugMode, selectedNodeIds]);

  // Keyboard handlers — undo/redo/copy/paste/delete/escape.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }
      if (readOnly) {
        if (event.key === "Escape") clearSelection();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (canUndo()) {
          clearSelection();
          undo();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === "y" || (event.key === "z" && event.shiftKey))) {
        event.preventDefault();
        if (canRedo()) {
          clearSelection();
          redo();
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "c") {
        if (selection.kind === "graph" && selection.nodeIds.length > 0) {
          event.preventDefault();
          graph.copySelection(selection.nodeIds);
        }
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "v") {
        event.preventDefault();
        handlePaste();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      }
      if (event.key === "Escape") {
        clearSelection();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, undo, redo, clearSelection, deleteSelected, selection, graph, handlePaste, readOnly]);

  const isFunctionCanvas = activeCanvasId !== MAIN_CANVAS_ID;

  // ── Render ───────────────────────────────────────────────────────────────

  const canvasArea = (
    <div className="flex flex-col h-full min-w-0">
      <CanvasTabsToolbar
        tabs={canvasTabs}
        activeTabId={activeCanvasId}
        onTabChange={onCanvasTabChange}
        onTabClose={onCanvasTabClose}
        onTabReorder={onCanvasTabReorder}
      />
      <div className="flex-1 relative">
        <CanvasEditor
          key={activeCanvasId}
          canvasId={activeCanvasId}
          viewportCenterRef={viewportCenterRef}
          nodeDefinitions={nodeDefinitions}
          onConnect={handleConnect}
          onAddNode={handleAddNode}
          onAddNodeAndConnect={handleAddNodeAndConnect}
          onSelectionChange={handleSelectionChange}
          onPaneClick={clearSelection}
          onNodeDragStart={handleNodeDragStart}
          setSelectionDrag={setSelectionDrag}
        />
      </div>
    </div>
  );

  return (
    <div className="h-full bg-canvas-bg flex flex-col">
      <div className="flex-1 flex overflow-hidden">
        <BuilderSidebar
          canvasId={activeCanvasId}
          activeTab={activeSidebarTab}
          onTabChange={setActiveSidebarTab}
          onAddNode={handleAddNode}
          nodeDefinitions={nodeDefinitions}
          getAllCategories={getAllCategories}
          onSelectNode={selectNodeById}
          onSelectEdge={selectEdgeById}
          isFunctionCanvas={isFunctionCanvas}
          functions={functions}
          onOpenFunction={onOpenFunction}
          onCreateFunction={onCreateFunction}
          isDebugMode={isDebugMode}
        />

        <div className="flex-1 flex flex-col h-full min-w-0">
          {isDebugMode ? (
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={75} minSize={30}>
                {canvasArea}
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={25} minSize={10}>
                <DebugConsolePanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            canvasArea
          )}
        </div>

        <RightConfigPanel
          canvasId={activeCanvasId}
          isDebugMode={isDebugMode}
          selectionDrag={selectionDrag}
          getNodeDef={getNodeDefinition}
          onNodeUpdate={graph.updateNode}
          onNodeDelete={graph.deleteNode}
          onEdgeUpdate={graph.updateEdge}
          onEdgeDelete={handleDeleteEdge}
          onClearSelection={clearSelection}
          onTestNode={onTestNode}
          onDebugStep={onDebugStep}
        />
      </div>
    </div>
  );
};
