import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getAllCanvasStores, MAIN_CANVAS_ID, subscribeFunctionInfoChanges } from "../stores/canvasStore";
import type { FunctionInfo } from "@foresthub/workflow-core";

// Cached snapshot of all function definitions
let cachedFunctions: Record<string, FunctionInfo> = {};
let snapshotVersion = 0;

// Compute all function definitions from all canvas stores
function computeAllFunctions(): Record<string, FunctionInfo> {
  const stores = getAllCanvasStores();
  const functions: Record<string, FunctionInfo> = {};

  Object.entries(stores).forEach(([id, store]) => {
    if (id === MAIN_CANVAS_ID) return;
    const info = store.getState().functionInfo;
    if (info) {
      functions[id] = info;
    }
  });

  return functions;
}

// Update the cache and increment version
function updateCache(): void {
  cachedFunctions = computeAllFunctions();
  snapshotVersion++;
}

// Initialize cache
updateCache();

// Subscribe handler that updates cache on changes
const subscribeToChanges = (callback: () => void) => {
  const unsubscribe = subscribeFunctionInfoChanges(() => {
    updateCache();
    callback();
  });
  return unsubscribe;
};

// Get the current snapshot
const getSnapshot = () => cachedFunctions;

/**
 * Hook that provides access to all function definitions across all canvas stores.
 * Uses useSyncExternalStore for React 18+ concurrent mode compatibility.
 *
 * The hook subscribes to function info changes and provides:
 * - functions: Record of all function definitions by ID
 * - functionsList: Array of all function definitions
 * - getFunction(id): Get a specific function by ID
 */
export function useFunctionRegistry() {
  const functions = useSyncExternalStore(subscribeToChanges, getSnapshot);

  const functionsList = useMemo(() => Object.values(functions), [functions]);

  const getFunction = useCallback((id: string): FunctionInfo | undefined => functions[id], [functions]);

  return {
    functions,
    functionsList,
    getFunction,
  };
}

/**
 * Get all functions without React subscription (for non-component code).
 * Note: This returns a snapshot that won't update reactively.
 */
export function getAllFunctions(): Record<string, FunctionInfo> {
  return cachedFunctions;
}
