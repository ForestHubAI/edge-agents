import { useCallback, useMemo } from "react";
import { useEditorStore } from "../stores/editorStore";
import type { FunctionDeclaration } from "@foresthubai/workflow-core/function";

// Functions are a project-scoped resource: the registry IS editorStore.functions —
// the domain FunctionDeclaration, no conversion. (Crossing to the flat api FunctionInfo
// is done only when stamping a call-site snapshot; see useNodeDefinitions/migration.)

/**
 * Access to all function declarations by id. Reactive over editorStore.functions.
 * - functions: Record of FunctionDeclaration by id
 * - functionsList: array of FunctionDeclaration
 * - getFunction(id): one declaration by id
 */
export function useFunctionRegistry() {
  const functions = useEditorStore((s) => s.functions);
  const functionsList = useMemo(() => Object.values(functions), [functions]);
  const getFunction = useCallback((id: string): FunctionDeclaration | undefined => functions[id], [functions]);

  return { functions, functionsList, getFunction };
}

/** All function declarations without React subscription (for non-component code). */
export function getAllFunctions(): Record<string, FunctionDeclaration> {
  return useEditorStore.getState().functions;
}
