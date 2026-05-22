import { useCallback } from "react";
import { useEditorStore } from "../stores/editorStore";
import { deleteCanvasStore, getOrCreateCanvasStore, getCanvasStore, syncFunctionArgVariables } from "../stores/canvasStore";
import { useFunctionRegistry } from "./useFunctionRegistry";
import type { FunctionInfo } from "@foresthub/workflow-core";
import { generateId } from "@foresthub/workflow-core/id";
import { ensureUids } from "@foresthub/workflow-core/variable";

export interface UseFunctionsOptions {
  /** Called when a function tab should be opened */
  onOpenTab: (id: string, name: string) => void;
  /** Called when a function tab should be removed */
  onRemoveTab: (id: string) => void;
  /** Called when a function tab should be renamed */
  onRenameTab: (id: string, newLabel: string) => void;
}

/**
 * Hook for managing functions using canvas stores as single source of truth.
 * Provides CRUD operations with integrated tab and canvas coordination.
 */
export const useFunctions = (options: UseFunctionsOptions) => {
  const { onOpenTab, onRemoveTab, onRenameTab } = options;

  // Subscribe to function registry (derived from all canvas stores)
  const { functionsList: functions, getFunction } = useFunctionRegistry();

  // Get setter for active canvas from editor store
  const setActiveCanvas = useEditorStore((state) => state.setActiveCanvas);

  // Open an existing function (creates tab if needed)
  const openFunction = useCallback(
    (functionId: string) => {
      const fn = getFunction(functionId);
      if (fn) {
        // Ensure canvas store exists
        getOrCreateCanvasStore(functionId);
        onOpenTab(functionId, fn.name);
        setActiveCanvas(functionId);
      }
    },
    [getFunction, onOpenTab, setActiveCanvas],
  );

  // Add a new function with optional inputs/outputs
  const addFunction = useCallback(
    (name: string, inputs?: FunctionInfo["arguments"], outputs?: FunctionInfo["returns"]) => {
      const newId = generateId();

      const functionInfo: FunctionInfo = {
        id: newId,
        name,
        version: 1,
        arguments: ensureUids(inputs ?? []),
        returns: ensureUids(outputs ?? []),
      };

      // Create canvas store for this function with functionInfo
      const canvasStore = getOrCreateCanvasStore(newId);
      canvasStore.getState().setFunctionInfo(() => functionInfo);
      syncFunctionArgVariables(canvasStore, functionInfo);

      // Switch to the new canvas and open tab
      onOpenTab(newId, name);
      setActiveCanvas(newId);

      return newId;
    },
    [setActiveCanvas, onOpenTab],
  );

  // Delete a function
  const deleteFunction = useCallback(
    (functionId: string) => {
      // Remove tab first
      onRemoveTab(functionId);

      // Delete the canvas store (also notifies function registry)
      deleteCanvasStore(functionId);
    },
    [onRemoveTab],
  );

  // Update function definition (inputs/outputs) - increments version
  const updateFunctionDefinition = useCallback((functionId: string, updates: FunctionInfo) => {
    const canvasStore = getCanvasStore(functionId);
    if (canvasStore) {
      canvasStore.getState().setFunctionInfo((info) => {
        if (!info) return info;
        return {
          ...info,
          version: info.version + 1,
          arguments: updates.arguments,
          returns: updates.returns,
        };
      });
      // Sync fnarg variables after updating functionInfo
      const updatedInfo = canvasStore.getState().functionInfo;
      syncFunctionArgVariables(canvasStore, updatedInfo);
    }
  }, []);

  // Rename a function
  const renameFunction = useCallback(
    (functionId: string, newName: string) => {
      const canvasStore = getCanvasStore(functionId);
      if (canvasStore) {
        canvasStore.getState().setFunctionInfo((info) => {
          if (!info) return info;
          return { ...info, name: newName };
        });
      }

      // Sync tab label
      onRenameTab(functionId, newName);
    },
    [onRenameTab],
  );

  // Update a function (name or inputs or outputs) - increments version
  const updateFunction = useCallback(
    (functionId: string, name: string, updates: FunctionInfo) => {
      const canvasStore = getCanvasStore(functionId);
      if (canvasStore) {
        canvasStore.getState().setFunctionInfo((info) => {
          if (!info) return info;
          return {
            ...info,
            name,
            version: info.version + 1,
            arguments: updates.arguments,
            returns: updates.returns,
          };
        });
        // Sync fnarg variables after updating functionInfo
        const updatedInfo = canvasStore.getState().functionInfo;
        syncFunctionArgVariables(canvasStore, updatedInfo);
      }

      // Sync tab label
      onRenameTab(functionId, name);
    },
    [onRenameTab],
  );

  // Get function info by id
  const getFunctionInfo = useCallback(
    (functionId: string): FunctionInfo | undefined => {
      return getFunction(functionId);
    },
    [getFunction],
  );

  return {
    functions,
    openFunction,
    addFunction,
    deleteFunction,
    renameFunction,
    updateFunctionDefinition,
    updateFunction,
    getFunctionInfo,
  };
};
