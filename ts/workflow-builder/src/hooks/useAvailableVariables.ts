import { useMemo } from "react";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../stores/canvasStore";
import { computeAvailableVariables } from "@foresthub/workflow-core/variable";

// Re-export types for consumers
export type { Variable as AvailableVariable } from "@foresthub/workflow-core/variable";

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
