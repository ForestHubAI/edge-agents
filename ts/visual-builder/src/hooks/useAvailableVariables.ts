import { useMemo } from "react";
import { isToolFlow, type EdgeType } from "@foresthub/workflow-core/types/edge";
import type { Edge } from "@xyflow/react";
import type { EdgeInstance } from "@foresthub/workflow-core/types/edge";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../store/canvasStore";
import type { AvailableVariable, CanvasVariable } from "../utils/variables";

// Re-export types for consumers
export type { AvailableVariable } from "../utils/variables";

/**
 * Pure function that computes available variables for a canvas from its own store state.
 * Function canvases are fully self-contained: they only see their own declared variables,
 * node outputs, and function arguments. Main-canvas state is never merged in — function
 * arguments are the only values that cross the scope boundary, and they arrive by value.
 *
 * Can be called imperatively outside React (e.g., from validateAllCanvases).
 */
export function computeAvailableVariables(
  variables: Record<string, CanvasVariable>,
  canvasEdges: Edge<EdgeInstance>[],
): { list: AvailableVariable[]; lookup: Record<string, AvailableVariable> } {
  const list: AvailableVariable[] = [];
  const lookup: Record<string, AvailableVariable> = {};

  // Node outputs routed to a tool port are scoped to the agent — exclude them.
  const toolNodeIds = new Set<string>();
  for (const edge of canvasEdges) {
    if (isToolFlow(edge.type as EdgeType)) toolNodeIds.add(edge.target);
  }

  for (const [key, variable] of Object.entries(variables)) {
    if (variable.kind === "node" && toolNodeIds.has(variable.nodeId)) continue;
    list.push(variable);
    lookup[key] = variable;
  }

  return { list, lookup };
}

/**
 * Hook that provides access to all available variables for a specific canvas.
 * Each canvas is self-contained — main and function canvases do not share scope.
 *
 * Returns both an array (for iteration/UI) and a record (for O(1) lookup).
 */
export const useAvailableVariables = (canvasId: string = MAIN_CANVAS_ID) => {
  const store = getOrCreateCanvasStore(canvasId);
  const variables = store((s) => s.variables);
  const edges = store((s) => s.edges);

  return useMemo(() => computeAvailableVariables(variables, edges), [variables, edges]);
};
