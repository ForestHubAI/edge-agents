// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Connection, Node, OnSelectionChangeFunc } from "@xyflow/react";
import type { NodeDefinition, NodeData } from "@foresthubai/workflow-core/node";
import { getPorts } from "@foresthubai/workflow-core/node";
import { getCompatibleNodeDefs } from "./utils/connectionRules";

import Canvas from "./Canvas";
import { NodePickerDialog } from "./dialogs/NodePickerDialog";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "./stores/canvasStore";
import type { PortActionDetail } from "./graph/PortHandle";

/**
 * The per-canvas editing surface. Wraps {@link Canvas} (the ReactFlow
 * primitive) with the popup state and viewport-center machinery that has
 * to remount when the user switches canvases.
 *
 * Mounted with `key={canvasId}` by {@link BuilderLayout} — when the active
 * canvas changes, this component fully remounts so port-popup, selection-
 * drag, and the viewport-center ref all reset cleanly without imperative
 * teardown.
 *
 * Graph mutations, history, and keyboard handling live one level up in
 * BuilderLayout so they can drive the sidebar and right panel siblings.
 */
export interface CanvasEditorProps {
  canvasId: string;

  /** Populated by Canvas/ReactFlow on mount; read by sidebar's click-to-add. */
  viewportCenterRef: MutableRefObject<(() => { x: number; y: number }) | null>;

  /** Node-palette registry for the contextual port-plus picker. */
  nodeDefinitions: NodeDefinition[];

  // Event handlers wired by BuilderLayout
  onConnect: (connection: Connection) => void;
  onAddNode: (nodeDef: NodeDefinition, position?: { x: number; y: number }) => string | null | undefined;
  onAddNodeAndConnect: (
    nodeDef: NodeDefinition,
    position: { x: number; y: number },
    connection: { source: string; sourceHandle: string; target: string; targetHandle: string },
  ) => string | null | undefined;
  onSelectionChange: OnSelectionChangeFunc;
  onPaneClick: () => void;
  onNodeDragStart: (event: React.MouseEvent, node: Node<NodeData>) => void;

  // Selection-drag flag (lifted to BuilderLayout so the right panel can read it)
  setSelectionDrag: Dispatch<SetStateAction<boolean>>;
}

export const CanvasEditor = ({
  canvasId,
  viewportCenterRef,
  nodeDefinitions,
  onConnect,
  onAddNode,
  onAddNodeAndConnect,
  onSelectionChange,
  onPaneClick,
  onNodeDragStart,
  setSelectionDrag,
}: CanvasEditorProps) => {
  const isFunctionCanvas = canvasId !== MAIN_CANVAS_ID;

  // Contextual node picker ("+" on output ports). PortHandle lives deep
  // inside ReactFlow's render tree, so it dispatches a bubbling CustomEvent
  // that we catch on this container — no prop drilling through RF needed.
  const [portAction, setPortAction] = useState<PortActionDetail | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: Event) => setPortAction((e as CustomEvent<PortActionDetail>).detail);
    el.addEventListener("port-plus-click", handler);
    return () => el.removeEventListener("port-plus-click", handler);
  }, []);

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
      const { nodes: currentNodes } = getOrCreateCanvasStore(canvasId).getState();
      const originNode = currentNodes.find((n) => n.id === portAction.nodeId);
      if (!originNode) return;
      const originPos = originNode.position;
      const position =
        portAction.portType === "tool"
          ? { x: originPos.x, y: originPos.y + 200 }
          : { x: originPos.x + 280, y: originPos.y };
      const newNodePorts = getPorts({ type: nodeDef.type } as NodeData);
      const targetPort = newNodePorts.input.find((p) => p.type === portAction.portType);
      if (!targetPort) return;
      onAddNodeAndConnect(nodeDef, position, {
        source: portAction.nodeId,
        sourceHandle: portAction.handleId,
        target: "",
        targetHandle: targetPort.id,
      });
      setPortAction(null);
    },
    [portAction, canvasId, onAddNodeAndConnect],
  );

  return (
    <div ref={containerRef} className="h-full flex flex-col">
      <div className="flex-1 relative">
        <Canvas
          canvasId={canvasId}
          onConnect={onConnect}
          onSelectionChange={onSelectionChange}
          onSelectionStart={() => setSelectionDrag(true)}
          onSelectionStop={() => setSelectionDrag(false)}
          onPaneClick={onPaneClick}
          onAddNode={onAddNode}
          onNodeDragStart={onNodeDragStart}
          viewportCenterRef={viewportCenterRef}
        />
      </div>

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
