import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../store/canvasStore";

/**
 * Hook that exposes all history functions from a canvas store.
 * Each canvas has its own independent undo/redo history.
 */
export const useCanvasHistory = (canvasId: string = MAIN_CANVAS_ID) => {
  const canvasStore = getOrCreateCanvasStore(canvasId);

  return {
    // History actions
    undo: canvasStore.undo,
    redo: canvasStore.redo,
    takeCheckpoint: canvasStore.takeCheckpoint,
    withCheckpoint: canvasStore.withCheckpoint,
    clearHistory: canvasStore.clearHistory,

    // History state checks
    canUndo: canvasStore.canUndo,
    canRedo: canvasStore.canRedo,
  };
};
