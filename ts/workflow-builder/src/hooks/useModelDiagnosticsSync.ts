import { useEffect } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { validateModel } from "@foresthub/workflow-core/diagnostics";

/**
 * Keeps `diagnosticsStore.byModelId` in sync with the editor's declared models.
 * Mirrors {@link useChannelDiagnosticsSync}/{@link useMemoryDiagnosticsSync}:
 * declared models are project-scoped, so diagnostics are written reactively from
 * a single root mount rather than tied to panel lifecycles.
 *
 * Mount once. Renders nothing.
 */
export function useModelDiagnosticsSync(): void {
  const models = useEditorStore((s) => s.models);

  useEffect(() => {
    const { setModelDiagnostics, clearModelDiagnostics, byModelId } = useDiagnosticsStore.getState();

    const seen = new Set<string>();
    for (const m of Object.values(models)) {
      seen.add(m.id);
      setModelDiagnostics(m.id, validateModel(m));
    }

    for (const id of Object.keys(byModelId)) {
      if (!seen.has(id)) clearModelDiagnostics(id);
    }
  }, [models]);
}
