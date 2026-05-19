import React from "react";
import { Handle, Position } from "@xyflow/react";
import { Plus } from "lucide-react";
import type { EdgeType } from "@foresthub/workflow-core/types/edge";

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
      border: "2px solid white",
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
        // Square shape for execution/control ports
        return {
          ...baseStyle,
          backgroundColor: "hsl(var(--success))",
          border: "2px solid hsl(var(--success-foreground))",
          borderRadius: "2px",
        };
      case "tool":
        // Diamond shape for tool ports via clip-path (no rotation offset)
        return {
          ...baseStyle,
          backgroundColor: "hsl(var(--accent))",
          border: "none",
          borderRadius: "0",
          clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
        };
      default:
        // Circle shape for data ports
        return {
          ...baseStyle,
          backgroundColor: "hsl(var(--primary))",
          border: "2px solid hsl(var(--primary-foreground))",
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
    switch (position) {
      case Position.Bottom:
        return "top-[20px] left-1/2 -translate-x-1/2";
      default:
        return "left-[20px] top-1/2 -translate-y-1/2";
    }
  };

  return (
    <div className="absolute z-20" style={style}>
      <Handle id={id} type={type} position={position} style={getHandleStyle()} isConnectable={!disabled} />
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
          className={`nodrag absolute flex items-center justify-center w-4 h-4 rounded-full bg-muted-foreground/60 text-background hover:bg-primary hover:scale-110 transition-all cursor-pointer ${getPlusPositionClass()}`}
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
