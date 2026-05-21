import { useEffect } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { validateMemory } from "@foresthub/workflow-core/diagnostics";

/**
 * Keeps `diagnosticsStore.byMemoryId` in sync with the editor's memory
 * primitives. Mirrors {@link useChannelDiagnosticsSync}: memory is
 * project-scoped (not canvas-scoped) and only rendered when the Memory sidebar
 * tab is open, so diagnostics are written reactively from a single root mount
 * rather than tied to panel lifecycles.
 *
 * Mount once. Renders nothing.
 */
export function useMemoryDiagnosticsSync(): void {
  const memory = useEditorStore((s) => s.memory);

  useEffect(() => {
    const { setMemoryDiagnostics, clearMemoryDiagnostics, byMemoryId } = useDiagnosticsStore.getState();

    const seen = new Set<string>();
    for (const m of Object.values(memory)) {
      seen.add(m.id);
      setMemoryDiagnostics(m.id, validateMemory(m));
    }

    // Drop entries for memories that have been deleted.
    for (const id of Object.keys(byMemoryId)) {
      if (!seen.has(id)) clearMemoryDiagnostics(id);
    }
  }, [memory]);
}
