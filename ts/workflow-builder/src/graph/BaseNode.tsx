// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import {
  NodeBase,
  NodeCategory,
  NodeDefinition,
  NodeData,
  getArguments,
  getPorts,
} from "@foresthubai/workflow-core/node";
import { NodeProps, Position } from "@xyflow/react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { memo, useCallback, useEffect, useMemo } from "react";
import { useAvailableVariables } from "../hooks/useAvailableVariables";
import { getOrCreateCanvasStore } from "../stores/canvasStore";
import { useDebugStore } from "../stores/debugStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useEditorStore } from "../stores/editorStore";
import { isReadOnly } from "../mode";
import { categoryIcons } from "../utils/categoryConstants";
import { computeNodeDiagnostics } from "@foresthubai/workflow-core/diagnostics";
import {
  parseExpression,
  type ParseResult,
  isExpression,
  resolveExpression,
  type ResolvedExpr,
} from "@foresthubai/workflow-core/expression";
import { isNodeUsedAsTool } from "@foresthubai/workflow-core/node";
import { canPortAcceptEdge } from "../utils/connectionRules";
import { PortHandle } from "./PortHandle";
import { isParameterActive } from "@foresthubai/workflow-core/parameter";
import { formatParamDisplay, displayValue } from "../utils/paramDisplay";

// Node shape variants
type NodeShape = "rectangle" | "tapered-right";

export interface BaseNodeProps extends NodeProps {
  nodeDefinition: NodeDefinition | undefined;
  isStale?: boolean;
  isDeleted?: boolean;
}

// Base Node component - handles all rendering logic
export const BaseNode = memo(
  ({ id, data, selected, nodeDefinition, isStale = false, isDeleted = false }: BaseNodeProps) => {
    const nodeData = data as NodeData;
    const isHighlighted = selected ?? false;
    // Read-only (preview/debug) disables edit affordances (e.g. add-edge handles)
    // but must NOT hide diagnostics — a viewer still needs to see errors/warnings.
    const isReadOnlyMode = useEditorStore((s) => isReadOnly(s.builderMode));

    // Debug cursor: true when this node is the current debug step target
    const isDebugCursor = useDebugStore(
      useCallback(
        (s) => {
          const p = s.phase;
          return (p.status === "paused" || p.status === "stepping") && p.cursorNodeId === id;
        },
        [id],
      ),
    );

    // Get active canvas ID with imperative access (no subscription), since it doesn't change for a node
    const activeCanvasId = useEditorStore.getState().activeCanvasId;

    // Get necessary canvas store data.
    // BaseNode must NEVER subscribe to s.nodes: dragging replaces the nodes array
    // every frame, so a nodes subscription re-renders all N nodes per frame (O(N²)).
    // Subscribing to s.edges is fine — edges keep their identity during a drag.
    const canvasStore = getOrCreateCanvasStore(activeCanvasId);
    const edges = canvasStore((s) => s.edges);
    const channels = useEditorStore((s) => s.channels);
    const memory = useEditorStore((s) => s.memory);
    const models = useEditorStore((s) => s.models);
    const availableModels = useEditorStore((s) => s.availableModels);

    // Get available variables for resolving expressions
    const { lookup: availableVariables } = useAvailableVariables(activeCanvasId);

    // Build channel ID → label lookup for formatParamDisplay
    const channelLabels = useMemo(() => {
      const labels: Record<string, string> = {};
      for (const v of Object.values(channels)) labels[v.id] = v.label;
      return labels;
    }, [channels]);

    // Build memory ID → label lookup for formatParamDisplay (memorySelect params)
    const memoryLabels = useMemo(() => {
      const labels: Record<string, string> = {};
      for (const m of Object.values(memory)) labels[m.id] = m.label;
      return labels;
    }, [memory]);

    // Build model ID → label lookup (catalog ∪ declared customs) + the catalog id
    // set — used for inline display and modelSelect reference validation.
    const { modelLabels, availableModelIds } = useMemo(() => {
      const labels: Record<string, string> = {};
      const ids = new Set<string>();
      for (const m of availableModels) {
        labels[m.id] = m.label;
        ids.add(m.id);
      }
      for (const m of Object.values(models)) labels[m.id] = m.label;
      return { modelLabels: labels, availableModelIds: ids };
    }, [availableModels, models]);

    // Get port definitions using centralized dispatcher
    const portDefinitions = useMemo(() => getPorts(nodeData), [nodeData]);

    // Separate ports by type for positioning
    const { executionInputs, toolInputs, executionOutputs, toolOutputs } = useMemo(() => {
      return {
        executionInputs: portDefinitions.input.filter((p) => p.type === "control"),
        toolInputs: portDefinitions.input.filter((p) => p.type === "tool"),
        executionOutputs: portDefinitions.output.filter((p) => p.type === "control"),
        toolOutputs: portDefinitions.output.filter((p) => p.type === "tool"),
      };
    }, [portDefinitions]);

    // Mutual exclusion: tool input vs control ports.
    // Tool OUTPUT is always allowed (not part of exclusion).
    const usedAsToolInput = useMemo(() => {
      return isNodeUsedAsTool(id, nodeData, edges);
    }, [id, nodeData, edges]);

    const parameters = getArguments(nodeData);

    // Set of parameter IDs that should be hidden given current context
    const hiddenParamIds = useMemo(() => {
      const ids = new Set<string>();
      for (const p of nodeDefinition?.parameters ?? []) {
        if (!isParameterActive(p, parameters, usedAsToolInput)) ids.add(p.id);
      }
      return ids.size > 0 ? ids : null;
    }, [usedAsToolInput, nodeDefinition, parameters]);

    const category = nodeDefinition?.category;

    // Compute diagnostics via extracted pure function
    const diagnostics = useMemo(
      () =>
        computeNodeDiagnostics({
          canvasId: activeCanvasId,
          nodeId: id,
          nodeData,
          nodeDefinition,
          availableVariables,
          channels,
          memory,
          models,
          availableModelIds,
          edges,
          isStale,
          isDeleted,
        }),
      [
        activeCanvasId,
        id,
        nodeData,
        nodeDefinition,
        availableVariables,
        channels,
        memory,
        models,
        availableModelIds,
        edges,
        isStale,
        isDeleted,
      ],
    );

    // Resolve expressions for display (separate from diagnostics)
    const resolvedExpressions = useMemo(() => {
      const resolved: Record<string, { expr: ResolvedExpr; parseRes: ParseResult }> = {};
      const paramDefs = nodeDefinition?.parameters ?? [];
      for (const param of paramDefs) {
        if (hiddenParamIds?.has(param.id)) continue;
        const value = parameters[param.id];
        if (isExpression(value)) {
          const expr = resolveExpression(value, availableVariables);
          const parseRes = parseExpression(expr);
          resolved[param.id] = { expr, parseRes };
        }
      }
      return resolved;
    }, [parameters, availableVariables, hiddenParamIds, nodeDefinition]);

    // Derived booleans from diagnostics
    const hasErrors = diagnostics.some((d) => d.severity === "error");
    const hasWarnings = diagnostics.some((d) => d.severity === "warning");

    // Write diagnostics to store (cleanup on unmount; validateAllCanvases handles full-project).
    // Runs in every mode: read-only viewers still need errors/warnings surfaced in
    // the sidebar and config panels.
    const setNodeDiagnostics = useDiagnosticsStore((s) => s.setNodeDiagnostics);
    const clearNodeDiagnostics = useDiagnosticsStore((s) => s.clearNodeDiagnostics);
    useEffect(() => {
      setNodeDiagnostics(id, diagnostics);
      return () => clearNodeDiagnostics(id);
    }, [id, diagnostics, setNodeDiagnostics, clearNodeDiagnostics]);

    const usedInControlFlow = useMemo(() => {
      return edges.some((e) => {
        if (e.source === id) {
          return executionOutputs.some((p) => p.id === e.sourceHandle);
        }
        if (e.target === id) {
          return executionInputs.some((p) => p.id === e.targetHandle);
        }
        return false;
      });
    }, [edges, id, executionInputs, executionOutputs]);

    const IconComponent = category ? categoryIcons[category] : null;

    // Determine node shape based on category
    const nodeShape: NodeShape = useMemo(() => {
      if (category === "Trigger") return "tapered-right";
      return "rectangle";
    }, [category]);

    // Get the color variable based on category
    const nodeColor = useMemo(() => {
      if (category === NodeCategory.Trigger) return "--node-trigger";
      if (category === NodeCategory.Tool) return "--node-tool";
      if (category === NodeCategory.AI) return "--node-agent";
      if (category === NodeCategory.Input) return "--node-input";
      if (category === NodeCategory.Output) return "--node-output";
      if (category === NodeCategory.Logic) return "--node-logic";
      if (category === NodeCategory.Data) return "--node-data";
      if (category === NodeCategory.Function) return "--node-function";
      return "--primary";
    }, [category]);

    // Determine if this node should have highlighted styling (Tool, Trigger, Agent)
    const fancyBg = category === NodeCategory.Tool || category === NodeCategory.Trigger || category === NodeCategory.AI;

    // Get parameters dynamically from node definition (must be before early return for hooks order)
    // Filter out hidden params based on display conditions
    const nodeParameters = useMemo(() => {
      const params = nodeDefinition?.parameters ?? [];
      if (!hiddenParamIds) return params;
      return params.filter((p) => !hiddenParamIds.has(p.id));
    }, [nodeDefinition, hiddenParamIds]);

    // Count visible inline params for height calculation (show first 3 params always)
    const visibleParamCount = useMemo(() => {
      const shown = Math.min(nodeParameters.length, 3);
      const hasOverflow = nodeParameters.length > 3 ? 1 : 0;
      return shown + hasOverflow;
    }, [nodeParameters]);

    // Calculate dimensions
    const maxExecutionPorts = Math.max(executionInputs.length, executionOutputs.length);
    const nodeWidth = 200;
    const taperWidth = 24;
    const paramLineHeight = 16; // ~text-xs line + space-y-0.5 gap
    const headerHeight = 50; // padding + emoji/badge row + margin
    const minHeight = useMemo(() => {
      const paramHeight = visibleParamCount * paramLineHeight;
      const contentHeight = headerHeight + paramHeight;
      if (nodeShape === "tapered-right") {
        return Math.max(contentHeight, 60 + Math.max(maxExecutionPorts, 1) * 40);
      }
      return Math.max(contentHeight, 80 + maxExecutionPorts * 40);
    }, [nodeShape, maxExecutionPorts, visibleParamCount]);

    if (!nodeDefinition) {
      return (
        <div className="min-w-[200px] p-3 border border-destructive/50 bg-destructive/10 rounded-lg">
          <div className="text-destructive text-sm">Unknown node: {nodeData.type}</div>
        </div>
      );
    }

    // Calculate vertical port positions for even distribution (left/right)
    const getVerticalPortPosition = (index: number, total: number) => {
      if (total === 1) return minHeight / 2;
      const spacing = (minHeight - 40) / (total + 1);
      return 20 + spacing * (index + 1);
    };

    // Calculate horizontal port positions for even distribution (top/bottom)
    const getHorizontalPortPosition = (index: number, total: number) => {
      if (total === 1) return nodeWidth / 2;
      const spacing = (nodeWidth - 40) / (total + 1);
      return 20 + spacing * (index + 1);
    };

    // Render SVG background shape
    const renderShape = () => {
      const gradientId = `node-gradient-${nodeData.id}`;
      const strokeW = 2;

      // Dark nodes (Tool, Trigger) use dark gradient, others use white/light background
      const gradientStartColor = `hsl(var(--canvas-background))`;
      const gradientEndColor = `color-mix(in srgb, hsl(var(${nodeColor})), hsl(var(--canvas-background)) 80%)`;
      const lightFill = "hsl(var(--card))";

      // Glow effect for highlighted state (our custom selection, not ReactFlow's)
      // Debug cursor gets an orange pulsing glow (takes priority over selection glow)
      const glowStyle = isDebugCursor
        ? {
            filter: `drop-shadow(0 0 14px hsl(var(--warning) / 0.7)) drop-shadow(0 0 24px hsl(var(--warning) / 0.5))`,
            animation: "debug-cursor-pulse 1.5s ease-in-out infinite",
          }
        : isHighlighted
          ? {
              filter: `drop-shadow(0 0 12px hsl(var(--selection-glow) / 0.6)) drop-shadow(0 0 20px hsl(var(--selection-glow) / 0.4))`,
            }
          : {};

      if (nodeShape === "tapered-right") {
        const inset = strokeW / 2;
        return (
          <svg
            className="absolute inset-0 z-0 transition-all duration-300 will-change-[filter]"
            width={nodeWidth}
            height={minHeight}
            viewBox={`0 0 ${nodeWidth} ${minHeight}`}
            preserveAspectRatio="none"
            style={glowStyle}
          >
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="70%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={gradientStartColor} />
                <stop offset="100%" stopColor={gradientEndColor} />
              </linearGradient>
            </defs>
            {/* Tapered right edge shape - rightmost edge at nodeWidth */}
            <path
              d={`
              M ${12 + inset} ${0 + inset}
              L ${nodeWidth - taperWidth - inset} ${0 + inset}
              L ${nodeWidth - inset} ${minHeight / 2}
              L ${nodeWidth - taperWidth - inset} ${minHeight - inset}
              L ${12 + inset} ${minHeight - inset}
              Q ${0 + inset} ${minHeight - inset} ${0 + inset} ${minHeight - 12 - inset}
              L ${0 + inset} ${12 + inset}
              Q ${0 + inset} ${0 + inset} ${12 + inset} ${0 + inset}
              Z
            `}
              fill={`url(#${gradientId})`}
              stroke={
                hasErrors
                  ? "hsl(var(--destructive))"
                  : fancyBg
                    ? `hsl(var(${nodeColor})/0.5)`
                    : "hsl(var(--edge-default))"
              }
              strokeWidth={strokeW}
            />
          </svg>
        );
      }

      // Rectangle shape (default) - use light or dark based on category
      return (
        <svg
          className="absolute inset-0 z-0 transition-all duration-300 will-change-[filter]"
          width={nodeWidth}
          height={minHeight}
          viewBox={`0 0 ${nodeWidth} ${minHeight}`}
          preserveAspectRatio="none"
          style={glowStyle}
        >
          {fancyBg && (
            <defs>
              <linearGradient id={gradientId} x1="0%" y1="70%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={gradientStartColor} />
                <stop offset="120%" stopColor={gradientEndColor} />
              </linearGradient>
            </defs>
          )}
          <rect
            x={strokeW / 2}
            y={strokeW / 2}
            width={nodeWidth - strokeW}
            height={minHeight - strokeW}
            rx="10"
            ry="10"
            fill={fancyBg ? `url(#${gradientId})` : lightFill}
            stroke={
              hasErrors
                ? "hsl(var(--destructive))"
                : fancyBg
                  ? `hsl(var(${nodeColor})/0.5)`
                  : "hsl(var(--edge-default))"
            }
            strokeWidth={strokeW}
          />
        </svg>
      );
    };

    return (
      <div className="relative z-0" style={{ height: `${minHeight}px`, width: `${nodeWidth}px` }}>
        {/* Tool input handles (top) — disabled when control ports are connected */}
        {toolInputs.map((port, index) => (
          <PortHandle
            key={port.id}
            id={port.id}
            type="target"
            position={Position.Top}
            portType={port.type}
            label={port.label}
            disabled={usedInControlFlow}
            style={{
              left: `${getHorizontalPortPosition(index, toolInputs.length)}px`,
            }}
          />
        ))}

        {/* Execution input handles (left) — disabled when tool input is connected */}
        {executionInputs.map((port, index) => (
          <PortHandle
            key={port.id}
            id={port.id}
            type="target"
            position={Position.Left}
            portType={port.type}
            label={port.label}
            disabled={usedAsToolInput}
            style={{
              top:
                nodeShape === "tapered-right"
                  ? `${minHeight / 2}px`
                  : `${getVerticalPortPosition(index, executionInputs.length)}px`,
            }}
          />
        ))}

        {/* SVG Shape */}
        {renderShape()}

        {/* Error badge */}
        {hasErrors && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <div className="absolute -top-4 -left-4 z-30 cursor-help">
                <AlertTriangle className="h-8 w-8 text-destructive fill-card" strokeWidth={2} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-destructive text-destructive-foreground text-xs px-2 py-1">
              {diagnostics.find((d) => d.severity === "error")?.message ?? "This node has errors"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Warning badge (only when no errors) */}
        {!hasErrors && hasWarnings && (
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <div className="absolute -top-4 -left-4 z-30 cursor-help">
                <AlertCircle className="h-8 w-8 text-warning fill-card" strokeWidth={2} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-warning text-warning-foreground text-xs px-2 py-1">
              {diagnostics.find((d) => d.severity === "warning")?.message ?? "This node has warnings"}
            </TooltipContent>
          </Tooltip>
        )}

        {/* Content overlay */}
        {/* Content overlay — top-aligned */}
        <div className={`relative z-10 p-3 ${nodeShape === "tapered-right" ? "pr-8" : ""}`}>
          {/* Header row: emoji + label badge */}
          <div className="flex items-center gap-1.5 min-w-0 mb-1.5">
            {IconComponent && (
              <IconComponent className="w-4 h-4 shrink-0" style={{ color: `hsl(var(${nodeColor}))` }} />
            )}
            <Badge
              variant="secondary"
              className="text-sm truncate max-w-full text-foreground"
              style={{
                backgroundColor: `hsl(var(${nodeColor}) / 0.3)`,
                borderColor: `hsl(var(${nodeColor}) / 0.4)`,
              }}
            >
              {(nodeData as NodeBase).label || nodeDefinition.label}
            </Badge>
          </div>

          {/* Parameters list */}
          {nodeParameters.length > 0 && (
            <div className="space-y-0.5">
              {nodeParameters.slice(0, 3).map((param) => {
                const value = parameters[param.id];
                const resolved = resolvedExpressions[param.id];

                const paramDisplay = resolved
                  ? null
                  : formatParamDisplay(param, value, availableVariables, channelLabels, memoryLabels, modelLabels);
                const isInvalid = resolved ? !resolved.parseRes.isValid : !!paramDisplay?.isInvalid;

                return (
                  <div key={param.id} className="text-xs leading-4 flex items-baseline gap-1 truncate">
                    <span className="shrink-0 text-muted-foreground">{param.label}:</span>
                    <span className={`font-mono truncate ${isInvalid ? "text-destructive" : "text-foreground"}`}>
                      {resolved ? displayValue(resolved.expr) : paramDisplay!.text}
                    </span>
                  </div>
                );
              })}
              {nodeParameters.length > 3 && (
                <div className="text-xs text-muted-foreground">+{nodeParameters.length - 3} more...</div>
              )}
            </div>
          )}
        </div>

        {/* Execution output handles (right) — disabled when tool input is connected */}
        {executionOutputs.map((port, index) => {
          const canAccept = !isReadOnlyMode && !usedAsToolInput && canPortAcceptEdge(nodeData, port.id, edges);
          return (
            <PortHandle
              key={port.id}
              id={port.id}
              type="source"
              position={Position.Right}
              portType={port.type}
              label={port.label}
              disabled={usedAsToolInput}
              showPlus={canAccept}
              nodeId={id}
              style={{
                top:
                  nodeShape === "tapered-right"
                    ? `${minHeight / 2}px`
                    : `${getVerticalPortPosition(index, executionOutputs.length)}px`,
                right: "0",
              }}
            />
          );
        })}

        {/* Tool output handles (bottom) */}
        {toolOutputs.map((port, index) => {
          const canAccept = !isReadOnlyMode && canPortAcceptEdge(nodeData, port.id, edges);
          return (
            <PortHandle
              key={port.id}
              id={port.id}
              type="source"
              position={Position.Bottom}
              portType={port.type}
              label={port.label}
              showPlus={canAccept}
              nodeId={id}
              style={{
                left: `${getHorizontalPortPosition(index, toolOutputs.length)}px`,
                bottom: 0,
              }}
            />
          );
        })}
      </div>
    );
  },
);
