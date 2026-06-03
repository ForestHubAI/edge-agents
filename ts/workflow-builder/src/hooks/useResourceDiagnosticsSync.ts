import { useEffect } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import type { Diagnostic } from "@foresthubai/workflow-core/diagnostics";

type EditorState = ReturnType<typeof useEditorStore.getState>;
type DiagnosticsState = ReturnType<typeof useDiagnosticsStore.getState>;

interface ResourceDiagnosticsSyncConfig<I extends { id: string }> {
  /** Pick the resource map (e.g. `s.channels`) off the editor store. */
  selectItems: (s: EditorState) => Record<string, I>;
  /** Validate one instance into its diagnostics. */
  validate: (item: I) => Diagnostic[];
  /** Read the matching diagnostics slot (e.g. `d.byChannelId`). */
  getStored: (d: DiagnosticsState) => Record<string, Diagnostic[]>;
  /** Write one instance's diagnostics. */
  set: (d: DiagnosticsState, id: string, diags: Diagnostic[]) => void;
  /** Drop one instance's diagnostics. */
  clear: (d: DiagnosticsState, id: string) => void;
}

/**
 * Keeps a project-scoped diagnostics slot (`byChannelId` / `byMemoryId` /
 * `byModelId`) in sync with the editor's resource map.
 *
 * These resources are project-scoped, not canvas-scoped, and are only rendered
 * visually when their sidebar tab is open. Tying diagnostic writes to card
 * lifecycles would mean errors vanish the moment that tab closes, so this hook
 * is mounted once at the workflow-builder root and reactively rewrites the store
 * whenever the resource map changes.
 *
 * Lifecycle handled implicitly by the effect:
 *  - Load   → setItems fires → effect re-runs → diagnostics written
 *  - Edit   → store mutates  → effect re-runs → entry replaced
 *  - Delete → item leaves    → orphan branch  → entry cleared
 *  - Unmount → store goes down with the app (no cleanup needed)
 */
export function useResourceDiagnosticsSync<I extends { id: string }>(config: ResourceDiagnosticsSyncConfig<I>): void {
  const items = useEditorStore(config.selectItems);

  useEffect(() => {
    const ds = useDiagnosticsStore.getState();

    const seen = new Set<string>();
    for (const item of Object.values(items)) {
      seen.add(item.id);
      config.set(ds, item.id, config.validate(item));
    }

    // Drop entries for items that have been deleted.
    for (const id of Object.keys(config.getStored(ds))) {
      if (!seen.has(id)) config.clear(ds, id);
    }
    // `config` is recreated each render but only `items` drives a resync; the
    // effect reads the latest closure on every run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);
}
