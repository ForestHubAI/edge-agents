import { useEffect } from "react";
import { validateFunction } from "@foresthubai/workflow-core/diagnostics";
import { useEditorStore } from "../stores/editorStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";

/**
 * Keeps the `byFunctionId` diagnostics slot in sync with the function declarations.
 * Mirrors useResourceDiagnosticsSync, but a function is a `FunctionDeclaration` (not a
 * flat `{ id, ... }` resource bag), so this is a dedicated variant. Mounted once at
 * the workflow-builder root so the sidebar badge/list ring survive tab open/close.
 * Validates the declaration only (name + output assignments); expression validity
 * against the body scope lives in validateWorkflowState.
 */
export function useFunctionDiagnosticsSync(): void {
  const functions = useEditorStore((s) => s.functions);

  useEffect(() => {
    const ds = useDiagnosticsStore.getState();

    const seen = new Set<string>();
    for (const [id, def] of Object.entries(functions)) {
      seen.add(id);
      ds.setFunctionDiagnostics(id, validateFunction(def));
    }

    for (const id of Object.keys(ds.byFunctionId)) {
      if (!seen.has(id)) ds.clearFunctionDiagnostics(id);
    }
  }, [functions]);
}
