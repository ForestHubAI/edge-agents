// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { useCallback } from "react";
import { useEditorStore } from "../stores/editorStore";
import { getOrCreateCanvasStore } from "../stores/canvasStore";
import { useFunctionRegistry } from "./useFunctionRegistry";
import { addFunction } from "../utils/functionOperations";

export interface UseFunctionsOptions {
  /** Open (or focus) a tab for a function canvas. */
  onOpenTab: (id: string, label: string) => void;
}

/**
 * Coordinates the canvas-tab UI with function declarations (editorStore). The
 * declarations themselves are CRUD'd in utils/functionOperations; this hook only
 * handles the open/create flows that must also touch the tab strip and selection.
 */
export const useFunctions = ({ onOpenTab }: UseFunctionsOptions) => {
  const { functionsList: functions, getFunction } = useFunctionRegistry();
  const selectFunction = useEditorStore((s) => s.selectFunction);

  // Open an existing function: ensure its body canvas exists, open its tab, and
  // select it so the right panel shows its definition. onOpenTab switches the active
  // canvas first; selectFunction sets the selection last so it isn't cleared.
  const openFunction = useCallback(
    (functionId: string) => {
      const fn = getFunction(functionId);
      if (!fn) return;
      getOrCreateCanvasStore(functionId);
      onOpenTab(functionId, fn.name);
      selectFunction(functionId);
    },
    [getFunction, onOpenTab, selectFunction],
  );

  // Create a new function and open it (the canvas body is created by addFunction).
  const createFunction = useCallback(() => {
    const fn = addFunction();
    onOpenTab(fn.id, fn.name);
    selectFunction(fn.id);
    return fn.id;
  }, [onOpenTab, selectFunction]);

  return { functions, openFunction, createFunction };
};
