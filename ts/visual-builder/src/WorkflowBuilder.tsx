import type { NodeCategory, NodeInstance, FunctionInfo } from "@foresthub/workflow-core/node";
import { NodeCategory as NodeCategoryEnum, NodeDefinition, getPorts } from "@foresthub/workflow-core/node";
import { toast } from "./hooks/use-toast";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./components/ui/resizable";
import type { Schemas } from "@foresthub/workflow-core";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { BuilderSidebar, type BuilderTab } from "./panels/BuilderSidebar";
import Canvas from "./Canvas";
import { CanvasTabsToolbar } from "./toolbars/CanvasTabsToolbar";
import { CanvasToolbar } from "./toolbars/CanvasToolbar";
import { useCanvasHistory } from "./hooks/useCanvasHistory";
import { CanvasTab } from "./hooks/useCanvasTabs";
import { useGraph } from "./hooks/useGraph";
import type { OnSelectionChangeFunc } from "@xyflow/react";
import { DebugConsolePanel } from "./panels/DebugConsolePanel";
import { DebugExternalIOPanel } from "./panels/DebugExternalIOPanel";
import { EdgeConfigPanel } from "./panels/EdgeConfigPanel";
import { ChannelConfigPanel } from "./panels/ChannelConfigPanel";
import { MemoryFileConfigPanel } from "./panels/MemoryFileConfigPanel";
import { NodeConfigPanel } from "./panels/NodeConfigPanel";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "./store/canvasStore";
import { useDebugStore } from "./store/debugStore";
import { useEditorStore, isReadOnly } from "./store/editorStore";
import type { EdgeInstance } from "@foresthub/workflow-core/edge";
import { migrateFunctionCallNodes } from "./utils/migrateFunctionNodes";
import { isControlFlow, type EdgeType } from "@foresthub/workflow-core/edge";
import { NodePickerDialog } from "./dialogs/NodePickerDialog";
import { getCompatibleNodeDefs } from "@foresthub/workflow-core/node";
import type { PortActionDetail } from "./graph/PortHandle";
import type { Connection } from "@xyflow/react";

interface WorkflowBuilderProps {
  canvasId: string;

  // Node definitions
  nodeDefinitions: NodeDefinition[];
  getNodeDef: (node: NodeInstance) => NodeDefinition | undefined;
  getAllCategories: () => NodeCategory[];

  // Functions
  functions: FunctionInfo[];
  onOpenFunction: (functionId: string) => void;
  onAddNewFunction: () => void; // Creates new function with default name
  onDeleteFunction: (functionId: string) => void;
  onRenameFunction: (functionId: string, newName: string) => void;

  // Toolbar operations
  onSave: () => void;
  onDeploy: () => void;

  onShowVersions: () => void;
  onOpenTest: (nodeId: string) => void;

  // Preview actions (drilled to CanvasToolbar)
  onRestoreFromPreview: () => void;
  onCancelPreview: () => void;
  onCreateFromPreview: () => void;

  // Debug actions
  onStartDebug: () => void;
  onStopDebug: () => void;
  onDebugStep: (nodeId?: string, externalState?: Schemas["DebugExternalState"]) => void;

  // Canvas tabs
  canvasTabs: CanvasTab[];
  onCanvasTabChange: (tabId: string) => void;
  onCanvasTabClose: (tabId: string) => void;
  onCanvasTabReorder: (fromIndex: number, toIndex: number) => void;

  // Agent info
  projectName?: string;

  // Sidebar state (lifted to survive canvas remounts)
  activeSidebarTab: BuilderTab;
  onSidebarTabChange: Dispatch<SetStateAction<BuilderTab>>;

  // Draft mode indicator
  isDraft: boolean;

  // Auto-save state for toolbar status indicator
  isDirty: boolean;
  isSaving: boolean;
}

export const WorkflowBuilder = ({
  canvasId,
  nodeDefinitions,
  getNodeDef,
  getAllCategories,
  functions,
  onOpenFunction,
  onAddNewFunction,
  onDeleteFunction,
  onRenameFunction,
  onSave,
  onDeploy,

  onShowVersions,
  onOpenTest,
  onRestoreFromPreview,
  onCancelPreview,
  onCreateFromPreview,
  onStartDebug,
  onStopDebug,
  onDebugStep,
  projectName,
  canvasTabs,
  onCanvasTabChange,
  onCanvasTabClose,
  onCanvasTabReorder,
  activeSidebarTab,
  onSidebarTabChange,
  isDraft,
  isDirty,
  isSaving,
}: WorkflowBuilderProps) => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const isDebugMode = useEditorStore((s) => s.builderMode.type === "debug");

  // Helper: get category for a node (used by debug panel to detect triggers)
  const getNodeCategory = useCallback(
    (node: NodeInstance) => getNodeDef(node)?.category as NodeCategoryEnum | undefined,
    [getNodeDef],
  );

  // Canvas-scoped hooks - stable because canvasId is a stable prop for this mount
  const graph = useGraph(canvasId, readOnly);

  // History operations from canvas store (undo/redo/checkpoint — not mutations)
  const { undo, redo, takeCheckpoint, canUndo, canRedo } = useCanvasHistory(canvasId);

  // Run migration on canvas mount (safety net for canvas switch, e.g. after undo on a function canvas)
  useEffect(() => {
    migrateFunctionCallNodes();
  }, []);

  // Selection state — centralized in editorStore, decoupled from ReactFlow's node.selected
  const selectedNodeIds = useEditorStore((s) => s.selectedNodeIds);
  const selectedEdgeIds = useEditorStore((s) => s.selectedEdgeIds);
  const selectedChannelId = useEditorStore((s) => s.selectedChannelId);
  const channels = useEditorStore((s) => s.channels);
  const setSelectedChannelId = useEditorStore((s) => s.setSelectedChannelId);
  const selectedMemoryFileId = useEditorStore((s) => s.selectedMemoryFileId);
  const memoryFiles = useEditorStore((s) => s.memoryFiles);
  const setSelectedMemoryFileId = useEditorStore((s) => s.setSelectedMemoryFileId);
  const setSelection = useEditorStore((s) => s.setSelection);
  const clearSelection = useEditorStore((s) => s.clearSelection);

  const selectedChannel = useMemo(
    () =>
      selectedChannelId
        ? Object.values(channels).find((v) => v.id === selectedChannelId) ?? null
        : null,
    [selectedChannelId, channels],
  );

  const selectedMemoryFile = useMemo(
    () =>
      selectedMemoryFileId
        ? Object.values(memoryFiles).find((m) => m.uid === selectedMemoryFileId) ?? null
        : null,
    [selectedMemoryFileId, memoryFiles],
  );

  const onSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selNodes, edges: selEdges }) => {
      setSelection(
        selNodes.map((n) => n.id),
        selEdges.map((e) => e.id),
      );
    },
    [setSelection],
  );

  const selectNodeById = useCallback((nodeId: string) => {
    setSelection([nodeId], []);
    const store = getOrCreateCanvasStore(canvasId).getState();
    store.selectNodes([nodeId]);
    store.selectEdges([]);
  }, [setSelection, canvasId]);

  const selectEdgeById = useCallback((edgeId: string) => {
    setSelection([], [edgeId]);
    const store = getOrCreateCanvasStore(canvasId).getState();
    store.selectNodes([]);
    store.selectEdges([edgeId]);
  }, [setSelection, canvasId]);

  const deleteSelected = useCallback(() => {
    const { selectedNodeIds: nodeIds, selectedEdgeIds: edgeIds } = useEditorStore.getState();
    graph.deleteSelected(nodeIds, edgeIds);
    clearSelection();
  }, [graph, clearSelection]);

  // Ref for getting viewport center from CanvasArea (for click-to-add placement)
  const viewportCenterRef = useRef<(() => { x: number; y: number }) | null>(null);

  // UI wrappers — useGraph handles checkpointing + readOnly gating internally.
  // These only add UI side-effects (toasts, auto-select, clear selection).
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
  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      graph.deleteEdges([edgeId]);
      clearSelection();
    },
    [graph, clearSelection],
  );
  const handleConnect = useCallback(
    (conn: Connection) => {
      const edgeType = graph.onConnect(conn);
      // Auto-select agent edges to open config panel for parameter entry
      if (edgeType && edgeType !== "control" && edgeType !== "tool") {
        const { edges: currentEdges } = getOrCreateCanvasStore(canvasId).getState();
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
    [graph, canvasId, selectEdgeById],
  );
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

  // Keep track of when selection rectangle is dragged to avoid opening NodeConfigPanel
  const [selectionDrag, setSelectionDrag] = useState(false);

  const isFunctionCanvas = canvasId !== MAIN_CANVAS_ID;

  // Debug mode: clicking a node sets the debug cursor
  useEffect(() => {
    if (!isDebugMode || selectedNodeIds.length !== 1) return;
    const nodeId = selectedNodeIds[0];
    const phase = useDebugStore.getState().phase;
    if (phase.status === "idle") {
      useDebugStore.getState().setPhase({ status: "paused", sessionId: phase.sessionId, cursorNodeId: nodeId });
    } else if (phase.status === "paused") {
      useDebugStore.getState().setPhase({ ...phase, cursorNodeId: nodeId });
    }
  }, [isDebugMode, selectedNodeIds]);

  // --- Contextual node picker ("+" on output ports) ---
  // PortHandle lives deep inside ReactFlow's render tree, so we can't pass callbacks via props.
  // Instead, PortHandle dispatches a "port-plus-click" CustomEvent that bubbles up the DOM.
  // We catch it here and open the picker dialog — no context or global store needed.
  const [portAction, setPortAction] = useState<PortActionDetail | null>(null);

  // Listen for the bubbling "port-plus-click" CustomEvent dispatched by PortHandle's "+" button
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el) return;
    const handler = (e: Event) => setPortAction((e as CustomEvent<PortActionDetail>).detail);
    el.addEventListener("port-plus-click", handler);
    return () => el.removeEventListener("port-plus-click", handler);
  }, []);

  // Compute compatible node definitions when the picker is open
  const compatibleDefs = useMemo(() => {
    if (!portAction) return [];
    const { nodes, edges } = getOrCreateCanvasStore(canvasId).getState();
    return getCompatibleNodeDefs(
      portAction.nodeId,
      portAction.handleId,
      nodes,
      edges,
      nodeDefinitions,
      isFunctionCanvas,
    );
  }, [portAction, canvasId, nodeDefinitions, isFunctionCanvas]);

  const handleAddAndConnect = useCallback(
    (nodeDef: NodeDefinition) => {
      if (!portAction) return;

      // Read origin node position from store
      const { nodes: currentNodes } = getOrCreateCanvasStore(canvasId).getState();
      const originNode = currentNodes.find((n) => n.id === portAction.nodeId);
      if (!originNode) return;

      // Compute new node position based on port type
      const originPos = originNode.position;
      const position =
        portAction.portType === "tool"
          ? { x: originPos.x, y: originPos.y + 200 }
          : { x: originPos.x + 280, y: originPos.y };

      // Find matching input port on the new node
      const newNodePorts = getPorts({ type: nodeDef.type } as NodeInstance);
      const targetPort = newNodePorts.input.find((p) => p.type === portAction.portType);
      if (!targetPort) return;

      // Batch add+connect as single undo entry
      const newNodeId = graph.addNodeAndConnect(nodeDef, position, {
        source: portAction.nodeId,
        sourceHandle: portAction.handleId,
        target: "", // filled by addNodeAndConnect with the new node ID
        targetHandle: targetPort.id,
      });

      if (newNodeId == null) {
        toast({ title: `Only one ${nodeDef.label} node allowed per canvas`, variant: "destructive" });
      }

      setPortAction(null);
    },
    [portAction, canvasId, graph],
  );

  // Keyboard handler for undo/redo/delete/escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable) {
        return;
      }

      // In read-only mode, only allow Escape (to close config panel)
      if (readOnly) {
        if (event.key === "Escape") clearSelection();
        return;
      }

      // Undo: Ctrl+Z (or Cmd+Z on Mac)
      if ((event.ctrlKey || event.metaKey) && event.key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (canUndo()) {
          clearSelection();
          undo();
        }
        return;
      }
      // Redo: Ctrl+Shift+Z or Ctrl+Y (or Cmd+Shift+Z / Cmd+Y on Mac)
      if ((event.ctrlKey || event.metaKey) && (event.key === "y" || (event.key === "z" && event.shiftKey))) {
        event.preventDefault();
        if (canRedo()) {
          clearSelection();
          redo();
        }
        return;
      }
      // Copy: Ctrl+C (or Cmd+C on Mac)
      if ((event.ctrlKey || event.metaKey) && event.key === "c") {
        if (selectedNodeIds.length > 0) {
          event.preventDefault();
          graph.copySelection(selectedNodeIds);
        }
        return;
      }
      // Paste: Ctrl+V (or Cmd+V on Mac)
      if ((event.ctrlKey || event.metaKey) && event.key === "v") {
        event.preventDefault();
        handlePaste();
        return;
      }
      // Delete
      if (event.key === "Delete" || event.key === "Backspace") {
        deleteSelected();
      }
      // Escape
      if (event.key === "Escape") {
        clearSelection(); // Causes config panel to close as well
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, undo, redo, clearSelection, deleteSelected, selectedNodeIds, graph, handlePaste, readOnly]);

  // Get selected node data from canvas store for config panel
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

  // Get selected edge from canvas store for edge config panel
  // Return the edge object directly (stable store reference) to avoid infinite re-renders
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
        data: (selectedEdgeRaw.data ?? {}) as EdgeInstance,
      }
    : null;

  // Count outgoing control-flow edges from the selected edge's source node
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

  // Handle node drag start - save checkpoint before drag (mutations come from ReactFlow asynchronously)
  const handleNodeDragStart = useCallback(() => {
    takeCheckpoint();
  }, [takeCheckpoint]);

  return (
    <div ref={canvasContainerRef} className="h-full bg-canvas-bg flex flex-col">
      {/* Toolbar */}
      <CanvasToolbar
        onSave={onSave}
        onDeploy={onDeploy}

        onShowVersions={onShowVersions}
        onRestoreFromPreview={onRestoreFromPreview}
        onCancelPreview={onCancelPreview}
        onCreateFromPreview={onCreateFromPreview}
        onStartDebug={onStartDebug}
        onStopDebug={onStopDebug}
        projectName={projectName}
        isDraft={isDraft}
        isDirty={isDirty}
        isSaving={isSaving}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Builder Sidebar (Left) */}
        <BuilderSidebar
          canvasId={canvasId}
          activeTab={activeSidebarTab}
          onTabChange={onSidebarTabChange}
          onAddNode={handleAddNode}
          nodeDefinitions={nodeDefinitions}
          getAllCategories={getAllCategories}
          onSelectNode={selectNodeById}
          onSelectEdge={selectEdgeById}
          isFunctionCanvas={isFunctionCanvas}
          functions={functions}
          onOpenFunction={onOpenFunction}
          onDeleteFunction={() => onDeleteFunction(canvasId)}
          onRenameFunction={(newName) => onRenameFunction(canvasId, newName)}
          isDebugMode={isDebugMode}
        />

        {/* Canvas Container with Tabs */}
        <div className="flex-1 flex flex-col h-full">
          {isDebugMode ? (
            /* Debug mode: resizable vertical split — canvas on top, console on bottom */
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={75} minSize={30}>
                <div className="flex flex-col h-full">
                  <CanvasTabsToolbar
                    tabs={canvasTabs}
                    activeTabId={canvasId}
                    onTabChange={onCanvasTabChange}
                    onTabClose={onCanvasTabClose}
                    onTabReorder={onCanvasTabReorder}
                    functions={functions}
                    onOpenFunction={onOpenFunction}
                    onAddNewFunction={onAddNewFunction}
                  />
                  <div className="flex-1 relative">
                    <Canvas
                      canvasId={canvasId}
                      onConnect={handleConnect}
                      onSelectionChange={onSelectionChange}
                      onSelectionStart={() => setSelectionDrag(true)}
                      onSelectionStop={() => setSelectionDrag(false)}
                      onPaneClick={clearSelection}
                      onAddNode={handleAddNode}
                      onNodeDragStart={handleNodeDragStart}
                      viewportCenterRef={viewportCenterRef}
                    />
                  </div>
                </div>
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={25} minSize={10}>
                <DebugConsolePanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          ) : (
            /* Normal mode: no bottom panel */
            <>
              <CanvasTabsToolbar
                tabs={canvasTabs}
                activeTabId={canvasId}
                onTabChange={onCanvasTabChange}
                onTabClose={onCanvasTabClose}
                onTabReorder={onCanvasTabReorder}
                functions={functions}
                onOpenFunction={onOpenFunction}
                onAddNewFunction={onAddNewFunction}
              />
              <div className="flex-1 relative">
                <Canvas
                  canvasId={canvasId}
                  onConnect={handleConnect}
                  onSelectionChange={onSelectionChange}
                  onSelectionStart={() => setSelectionDrag(true)}
                  onSelectionStop={() => setSelectionDrag(false)}
                  onPaneClick={clearSelection}
                  onAddNode={handleAddNode}
                  onNodeDragStart={handleNodeDragStart}
                  viewportCenterRef={viewportCenterRef}
                />
              </div>
            </>
          )}
        </div>

        {/* Right Panel — Debug External I/O (on node select) or normal config panels */}
        {isDebugMode ? (
          !selectionDrag &&
          selectedNode && (
            <div className="w-80 border-l border-border bg-background overflow-y-auto p-3">
              <DebugExternalIOPanel canvasId={canvasId} onStep={onDebugStep} getNodeCategory={getNodeCategory} />
            </div>
          )
        ) : (
          <>
            {!selectionDrag && selectedNode && (
              <div className="w-80 border-l border-border bg-card overflow-y-auto">
                <NodeConfigPanel
                  canvasId={canvasId}
                  selectedNode={selectedNode}
                  onNodeUpdate={graph.updateNode}
                  onNodeDelete={graph.deleteNode}
                  onClose={clearSelection}
                  onOpenTest={onOpenTest}
                  getNodeDef={getNodeDef}
                />
              </div>
            )}
            {!selectionDrag && !selectedNode && selectedEdge && (
              <div className="w-80 border-l border-border bg-card overflow-y-auto">
                <EdgeConfigPanel
                  canvasId={canvasId}
                  edgeId={selectedEdge.id}
                  edgeType={selectedEdge.type}
                  edgeData={selectedEdge.data}
                  sourceControlEdgeCount={sourceControlEdgeCount}
                  onEdgeUpdate={graph.updateEdge}
                  onEdgeDelete={handleDeleteEdge}
                  onClose={clearSelection}
                />
              </div>
            )}
            {!selectionDrag && !selectedNode && !selectedEdge && selectedChannel && (
              <div className="w-80 border-l border-border bg-card overflow-y-auto">
                <ChannelConfigPanel channel={selectedChannel} onClose={() => setSelectedChannelId(null)} />
              </div>
            )}
            {!selectionDrag && !selectedNode && !selectedEdge && !selectedChannel && selectedMemoryFile && (
              <div className="w-80 border-l border-border bg-card overflow-y-auto">
                <MemoryFileConfigPanel
                  memoryFile={selectedMemoryFile}
                  onClose={() => setSelectedMemoryFileId(null)}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Contextual node picker dialog */}
      <NodePickerDialog
        open={portAction !== null}
        onOpenChange={(open) => {
          if (!open) setPortAction(null);
        }}
        compatibleDefs={compatibleDefs}
        onSelect={handleAddAndConnect}
      />
    </div>
  );
};
