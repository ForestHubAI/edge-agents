import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Plus } from "lucide-react";
import type { EdgeType } from "@foresthub/workflow-core/edge";

export interface PortActionDetail {
  nodeId: string;
  handleId: string;
  portType: EdgeType;
}

export interface PortHandleProps {
  id: string;
  nodeId?: string;
  type: "source" | "target";
  position: Position;
  portType: EdgeType;
  label?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  showPlus?: boolean;
}

export const PortHandle = ({
  id,
  nodeId,
  type,
  position,
  portType,
  label,
  style,
  disabled,
  showPlus,
}: PortHandleProps) => {
  const getHandleStyle = () => {
    const baseStyle: React.CSSProperties = {
      width: "12px",
      height: "12px",
      // Outline matches the canonical graph-line color (same as edges + node borders).
      border: "2px solid hsl(var(--edge-default))",
    };

    if (disabled) {
      return {
        ...baseStyle,
        backgroundColor: "hsl(var(--muted-foreground) / 0.3)",
        border: "2px solid hsl(var(--muted-foreground) / 0.4)",
        borderRadius: portType === "control" ? "2px" : portType === "tool" ? "2px" : "50%",
        opacity: 0.8,
        cursor: "not-allowed",
        ...(portType === "tool" ? { clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" } : {}),
      };
    }

    switch (portType) {
      case "control":
        // Square shape for execution/control ports. Fill matches the node body
        // (--card) so the port reads as a recessed hole outlined in the graph color.
        return {
          ...baseStyle,
          backgroundColor: "hsl(var(--card))",
          borderRadius: "2px",
        };
      case "tool":
        // Diamond via clip-path so the handle stays anchored on the node edge
        // (rotating it would override React Flow's centering transform). A
        // clip-path can't show a border, so the handle background is the outline
        // color and an inset inner diamond (rendered as a child below) paints the
        // canonical tool fill (--node-tool), leaving a 2px edge-default outline.
        return {
          ...baseStyle,
          backgroundColor: "hsl(var(--edge-default))",
          border: "none",
          borderRadius: "0",
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        };
      default:
        // Circle shape as fallback
        return {
          ...baseStyle,
          backgroundColor: "white",
          borderRadius: "50%",
        };
    }
  };

  const getLabelPositionClass = () => {
    switch (position) {
      case Position.Left:
        return "right-full mr-3 text-right";
      case Position.Right:
        return "left-full ml-3 text-left";
      case Position.Top:
        return "bottom-full mb-2 text-center left-1/2 -translate-x-1/2";
      case Position.Bottom:
        return "top-full mt-2 text-center left-1/2 -translate-x-1/2";
      default:
        return "left-full ml-3 text-left";
    }
  };

  const getLabelStyle = (): React.CSSProperties => {
    if (position === Position.Left || position === Position.Right) {
      return {
        top: "50%",
        transform: "translateY(calc(-50% + 12px))",
      };
    }
    return {};
  };

  const getPlusPositionClass = () => {
    // Center with a negative margin (button is w-4 h-4 = 16px, so -8px = -2),
    // NOT a translate. The hover effect uses `transform: scale()`, and reusing
    // transform for centering too makes the translate drop out mid-animation,
    // which both off-centers the plus and makes it jump on hover.
    switch (position) {
      case Position.Bottom:
        return "top-[15px] left-1/2 -ml-2";
      default:
        return "left-[15px] top-1/2 -mt-2";
    }
  };

  // Nudge the *visible* dot 1px toward the node interior so it sits on the
  // outline centerline (the SVG border is strokeW=2). The offset is on a child,
  // NOT the Handle — React Flow anchors edges to the Handle's measured box, so
  // keeping that on the node edge means edges still connect flush instead of
  // stopping 1px short.
  const dotOffset =
    position === Position.Top
      ? "translateY(1px)"
      : position === Position.Bottom
        ? "translateY(-1px)"
        : position === Position.Left
          ? "translateX(1px)"
          : "translateX(-1px)";

  return (
    <div className="absolute z-20" style={style}>
      <Handle
        id={id}
        type={type}
        position={position}
        isConnectable={!disabled}
        style={{ width: "12px", height: "12px", background: "transparent", border: "none", minWidth: 0, minHeight: 0 }}
      >
        <div
          style={{ ...getHandleStyle(), position: "absolute", inset: 0, transform: dotOffset, pointerEvents: "none" }}
        >
          {portType === "tool" && !disabled && (
            <div
              style={{
                position: "absolute",
                inset: "2px",
                backgroundColor: "hsl(var(--node-tool))",
                clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
              }}
            />
          )}
        </div>
      </Handle>
      {label && !disabled && (
        <div
          className={`absolute text-xs text-muted-foreground pointer-events-none select-none whitespace-nowrap ${getLabelPositionClass()}`}
          style={getLabelStyle()}
        >
          {label}
        </div>
      )}
      {showPlus && !disabled && nodeId && (
        <button
          type="button"
          title="Add port"
          className={`nodrag absolute flex items-center justify-center w-4 h-4 rounded-full bg-muted-foreground/60 text-card hover:bg-primary hover:scale-110 transition-all cursor-pointer ${getPlusPositionClass()}`}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            const detail: PortActionDetail = { nodeId, handleId: id, portType };
            e.currentTarget.dispatchEvent(new CustomEvent("port-plus-click", { detail, bubbles: true }));
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Plus className="w-2.5 h-2.5" strokeWidth={3} />
        </button>
      )}
    </div>
  );
};
