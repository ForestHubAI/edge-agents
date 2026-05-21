import { useEffect } from "react";
import { useEditorStore } from "../stores/editorStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { validateChannel } from "@foresthub/workflow-core/diagnostics";

/**
 * Keeps `diagnosticsStore.byChannelId` in sync with the editor's channels.
 *
 * Channels are project-scoped state, not canvas-scoped, and they're only
 * rendered visually when the user opens the channels sidebar tab. Tying
 * diagnostic writes to card lifecycles would mean errors disappear the
 * moment that tab closes. Instead this hook is mounted once at the
 * workflow-builder root and reactively rewrites the store whenever the
 * channel map changes.
 *
 * Mount once. Renders nothing.
 *
 * Lifecycle handled implicitly by the effect:
 *  - Project load → setChannels fires → effect re-runs → diagnostics written
 *  - Edit         → store mutates    → effect re-runs → entry replaced
 *  - Delete       → channel leaves   → orphan branch  → entry cleared
 *  - App unmount  → cleanup-on-unmount → all entries dropped
 */
export function useChannelDiagnosticsSync(): void {
  const channels = useEditorStore((s) => s.channels);

  useEffect(() => {
    const { setChannelDiagnostics, clearChannelDiagnostics, byChannelId } = useDiagnosticsStore.getState();

    const seen = new Set<string>();
    for (const v of Object.values(channels)) {
      seen.add(v.id);
      setChannelDiagnostics(v.id, validateChannel(v));
    }

    // Drop entries for channels that have been deleted.
    for (const id of Object.keys(byChannelId)) {
      if (!seen.has(id)) clearChannelDiagnostics(id);
    }

    // No cleanup function — orphans are reaped by the next run, and on full
    // unmount the store goes down with the app anyway.
  }, [channels]);
}
