// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../stores/canvasStore";

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
