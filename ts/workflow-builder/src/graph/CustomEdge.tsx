import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { BaseEdge, EdgeLabelRenderer, getBezierPath, Position, useEdges } from "@xyflow/react";
import { AlertTriangle } from "lucide-react";
import { EdgeInstance, isControlFlow, isToolFlow, type EdgeType } from "@foresthub/workflow-core/edge";
import { useEffect, useMemo } from "react";
import { useAvailableVariables } from "../hooks/useAvailableVariables";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { computeEdgeDiagnostics } from "@foresthub/workflow-core/diagnostics";

const EDGE_BASE_COLOR = "hsl(var(--edge-default))";
const AGENT_COLOR = "hsl(var(--node-agent))";
const ERROR_COLOR = "hsl(var(--destructive))";

/**
 * Source/target stroke colors per edge type. Plain control and tool edges use
 * the neutral edge base on both ends. Edges that touch an Agent pick up the
 * agent color on that side, so the SVG gradient makes the edge visually
 * announce its agent endpoint (e.g. agentTask fades base → agent toward the
 * target Agent).
 */
function endColors(type: EdgeType): { source: string; target: string } {
  switch (type) {
    case "control":
    case "tool":
      return { source: EDGE_BASE_COLOR, target: EDGE_BASE_COLOR };
    case "agentTask":
      return { source: EDGE_BASE_COLOR, target: AGENT_COLOR };
    case "agentChoice":
      return { source: AGENT_COLOR, target: EDGE_BASE_COLOR };
    case "agentDelegate":
      return { source: AGENT_COLOR, target: AGENT_COLOR };
  }
}

export const CustomEdge = ({
  id,
  source,
  type,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
}: {
  id: string;
  source: string;
  type: string;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  data?: EdgeInstance;
  selected?: boolean;
}) => {
  const isHighlighted = selected ?? false;
  const isPreview = useEditorStore((s) => isReadOnly(s.builderMode));
  const edgeType = (type ?? "control") as EdgeType;
  const edges = useEdges();
  const activeCanvasId = useEditorStore.getState().activeCanvasId;
  const { lookup: availableVariables } = useAvailableVariables(activeCanvasId);

  const sourceControlEdgeCount = edges.filter((e) => e.source === source && isControlFlow(e.type as EdgeType)).length;

  // Compute edge diagnostics via extracted pure function
  const diagnostics = useMemo(
    () =>
      computeEdgeDiagnostics({
        canvasId: activeCanvasId,
        edgeId: id,
        edgeType,
        edgeData: data,
        availableVariables,
        sourceControlEdgeCount,
      }),
    [edgeType, sourceControlEdgeCount, data, availableVariables, activeCanvasId, id],
  );

  const hasErrors = diagnostics.length > 0;

  // Write diagnostics to store (cleanup on unmount; validateAllCanvases handles full-project)
  const setEdgeDiagnostics = useDiagnosticsStore((s) => s.setEdgeDiagnostics);
  const clearEdgeDiagnostics = useDiagnosticsStore((s) => s.clearEdgeDiagnostics);
  useEffect(() => {
    if (isPreview) return;
    setEdgeDiagnostics(id, diagnostics);
    return () => clearEdgeDiagnostics(id);
  }, [id, diagnostics, setEdgeDiagnostics, clearEdgeDiagnostics, isPreview]);

  const getEdgePath = () => {
    if (isToolFlow(edgeType)) {
      // Ends have vertical slope
      return getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
      });
    }
    // Control flow: ends have horizontal slope
    return getBezierPath({
      sourceX,
      sourceY,
      sourcePosition: Position.Right,
      targetX,
      targetY,
      targetPosition: Position.Left,
    });
  };

  const [edgePath, labelX, labelY] = getEdgePath();
  const colors = hasErrors ? { source: ERROR_COLOR, target: ERROR_COLOR } : endColors(edgeType);
  const strokeWidth = 3;
  const gradientId = `edge-gradient-${id}`;

  // Glow effect for highlighted edges — uniform high-contrast color (or
  // destructive when the edge itself is errored).
  const glowColor = hasErrors ? ERROR_COLOR : "hsl(var(--selection-glow))";
  const glowFilter = isHighlighted ? `drop-shadow(0 0 8px ${glowColor}) drop-shadow(0 0 16px ${glowColor})` : undefined;

  return (
    <>
      <g style={{ filter: glowFilter }}>
        <defs>
          {/* gradientUnits=userSpaceOnUse anchors the stops to the edge's actual
              source/target coordinates, so the fade follows the wire regardless
              of its bounding box (which is what objectBoundingBox would use). */}
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            <stop offset="0%" stopColor={colors.source} />
            <stop offset="100%" stopColor={colors.target} />
          </linearGradient>
        </defs>
        <BaseEdge
          id={id}
          path={edgePath}
          style={{
            stroke: `url(#${gradientId})`,
            strokeWidth,
            strokeDasharray: "none",
          }}
        />
      </g>
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: "all",
          }}
          className="flex flex-col items-center gap-0.5"
        >
          {hasErrors && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <div className="cursor-help">
                  <AlertTriangle className="h-5 w-5 text-destructive fill-background" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-destructive text-destructive-foreground text-xs px-2 py-1">
                {diagnostics[0]?.message ?? "This edge has errors"}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default CustomEdge;
