import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Connection,
  Controls,
  EdgeChange,
  MiniMap,
  Node,
  NodeChange,
  OnSelectionChangeFunc,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useReactFlow,
} from "@xyflow/react";
import React, { useCallback } from "react";
import { useResolvedTheme } from "./hooks/useResolvedTheme";

import { NodeCategory, NodeDefinition, NodeInstance } from "@foresthub/workflow-core/node";
import { isValidConnection as validateConnection } from "@foresthub/workflow-core/node";
import { getOrCreateCanvasStore } from "./store/canvasStore";
import { useEditorStore, isReadOnly } from "./store/editorStore";
import { nodeTypes, edgeTypes } from "./graph/reactFlowRegistry";

interface CanvasProps {
  canvasId: string;
  onConnect: (connection: Connection) => void;
  onSelectionChange: OnSelectionChangeFunc;
  onSelectionStart: () => void;
  onSelectionStop: () => void;
  onPaneClick: (event: React.MouseEvent) => void;
  onAddNode: (nodeType: NodeDefinition, position?: { x: number; y: number }) => void;
  onNodeDragStart: (event: React.MouseEvent, node: Node<NodeInstance>) => void;
  viewportCenterRef: React.MutableRefObject<(() => { x: number; y: number }) | null>;
}

// Inner component that uses useReactFlow - must be inside ReactFlowProvider
const CanvasArea = ({
  canvasId,
  onConnect,
  onSelectionChange,
  onSelectionStart,
  onSelectionStop,
  onPaneClick,
  onAddNode,
  onNodeDragStart,
  viewportCenterRef,
}: CanvasProps) => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const resolvedTheme = useResolvedTheme();
  const { screenToFlowPosition, getViewport } = useReactFlow();

  // Expose viewport center calculation to parent via ref
  React.useEffect(() => {
    viewportCenterRef.current = () => {
      const container = document.querySelector(".react-flow");
      if (!container) return { x: 250, y: 100 };
      const { width, height } = container.getBoundingClientRect();
      const { x, y, zoom } = getViewport();
      // Offset by approximate half-node size so the node appears centered, not top-left aligned
      return {
        x: (-x + width / 2) / zoom - 90,
        y: (-y + height / 2) / zoom - 50,
      };
    };
  }, [getViewport, viewportCenterRef]);

  // Get the independent store for this canvas - direct top-level access
  const useStore = getOrCreateCanvasStore(canvasId);
  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  const setNodes = useStore((s) => s.setNodes);
  const setEdges = useStore((s) => s.setEdges);

  // Function to determine node color for MiniMap (uses ReactFlow node types, not domain NodeType)
  const nodeColor = (node: Node) => {
    switch (node.type) {
      case NodeCategory.Trigger:
        return "hsl(var(--node-trigger))";
      case NodeCategory.Tool:
        return "hsl(var(--node-tool))";
      case NodeCategory.AI:
        return "hsl(var(--node-agent))";
      default:
        return "hsl(var(--muted))";
    }
  };

  // ReactFlow change handlers - apply changes directly to store
  const onNodesChange = useCallback(
    (changes: NodeChange<Node<NodeInstance>>[]) => {
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    [setNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds) as typeof eds);
    },
    [setEdges],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      if (!onAddNode || readOnly) return;

      try {
        const dragData = JSON.parse(event.dataTransfer.getData("application/json"));
        // Convert screen coordinates to flow coordinates (accounting for pan/zoom)
        const position = screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        });

        onAddNode(dragData.nodeDef, position);
      } catch (error) {
        console.error("Failed to parse node data:", error);
      }
    },
    [onAddNode, screenToFlowPosition, readOnly],
  );

  const handleDragOver = (event: React.DragEvent) => {
    if (readOnly) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  // Prevent browser middle-click auto-scroll which causes viewport jumps
  const handleMouseDownCapture = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  const handleAuxClick = (e: React.MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
    }
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={(c) => !!validateConnection(c.source, c.target, c.sourceHandle, c.targetHandle, nodes, edges)}
      onPaneClick={onPaneClick}
      onNodeDragStart={onNodeDragStart}
      onSelectionChange={onSelectionChange}
      onSelectionStart={onSelectionStart}
      onSelectionEnd={onSelectionStop}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onInit={(instance) => instance.fitView({ padding: 0.15, maxZoom: 1 })}
      selectionOnDrag={!readOnly}
      panOnDrag={[1, 2]}
      selectionMode={SelectionMode.Partial}
      selectNodesOnDrag={false}
      nodesConnectable={!readOnly}
      nodesDraggable={!readOnly}
      zoomOnScroll={true}
      zoomOnPinch={true}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      deleteKeyCode={null} // Disable delete controlled by react flow itself
      onContextMenu={(e) => e.preventDefault()}
      onMouseDownCapture={handleMouseDownCapture}
      onAuxClick={handleAuxClick}
      colorMode={resolvedTheme}
      style={{ "--xy-background-color": "hsl(var(--canvas-background))" } as React.CSSProperties}
    >
      <Background
        variant={BackgroundVariant.Dots}
        color="hsl(var(--muted-foreground))"
        gap={24}
        size={1.5}
        className="opacity-40"
      />
      <Controls className="glass-forest-panel !border !shadow-lg [&_button]:glass-forest-button [&_button]:!text-foreground hover:[&_button]:!scale-105" />
      <MiniMap
        nodeColor={nodeColor}
        className="glass-forest-panel !border !shadow-lg"
        maskColor="hsl(var(--primary) / 0.15)"
        nodeBorderRadius={12}
        nodeStrokeWidth={2}
        style={{ width: 120, height: 80 }}
      />
    </ReactFlow>
  );
};

// Wrapper component that provides ReactFlowProvider context
const Canvas = (props: CanvasProps) => {
  return (
    <div className="w-full h-full overflow-hidden overscroll-contain">
      <ReactFlowProvider>
        <CanvasArea {...props} />
      </ReactFlowProvider>
    </div>
  );
};

export default Canvas;
