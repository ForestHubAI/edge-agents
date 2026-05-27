import { useEffect } from "react";
import { validateFunction } from "@foresthubai/workflow-core/diagnostics";
import { computeAvailableVariables } from "@foresthubai/workflow-core/variable";
import { useEditorStore } from "../stores/editorStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { getCanvasStore } from "../stores/canvasStore";

/**
 * Keeps the `byFunctionId` diagnostics slot in sync with the function declarations —
 * the single source for the sidebar tab badge, the function list ring, AND the config
 * panel's per-output rings (they all read this slot). Mounted once at the
 * workflow-builder root so it survives tab open/close.
 *
 * Scope-aware: each function is validated against its own body canvas's variables, so
 * invalid/typed return expressions surface here too — not just missing ones. (Reacts
 * to declaration/expression edits via `functions`; a body-only edit that changes the
 * available variables without touching a declaration refreshes on the next
 * declaration change or a full `validate`.)
 */
export function useFunctionDiagnosticsSync(): void {
  const functions = useEditorStore((s) => s.functions);

  useEffect(() => {
    const ds = useDiagnosticsStore.getState();

    const seen = new Set<string>();
    for (const [id, def] of Object.entries(functions)) {
      seen.add(id);
      const store = getCanvasStore(id);
      const lookup = store
        ? computeAvailableVariables(store.getState().variables, store.getState().edges).lookup
        : undefined;
      ds.setFunctionDiagnostics(id, validateFunction(def, lookup));
    }

    for (const id of Object.keys(ds.byFunctionId)) {
      if (!seen.has(id)) ds.clearFunctionDiagnostics(id);
    }
  }, [functions]);
}
