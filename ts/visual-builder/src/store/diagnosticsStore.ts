/**
 * diagnosticsStore.ts
 *
 * This Zustand store manages diagnostics (errors and warnings) for the currently active canvas
 * in the visual builder. It holds diagnostics for nodes and edges, keyed by their IDs.
 *
 * Key design points:
 * - Only diagnostics for the active canvas are stored (flat, not per-canvas).
 * - Diagnostics are written by node/edge components via useEffect, and cleared on unmount.
 * - On canvas switch, the store is cleared and repopulated for the new canvas.
 * - Used for real-time UI feedback (badges, warnings) in the visual builder.
 * - For full-project validation (e.g., before code generation), use validateAllCanvases() in utils/diagnostics.ts.
 *
 * See docs/diagnostics.md for full architecture and lifecycle details.
 */
import { create } from "zustand";
import type { Diagnostic } from "@foresthub/workflow-core/diagnostics";

interface DiagnosticsState {
  byNodeId: Record<string, Diagnostic[]>;
  byEdgeId: Record<string, Diagnostic[]>;
  /**
   * Channels are project-scoped, not canvas-scoped, so this slot lives
   * here regardless of the active canvas. Written by ChannelDiagnosticsSync,
   * which is mounted once at the visual builder root.
   */
  byChannelId: Record<string, Diagnostic[]>;
  setNodeDiagnostics: (nodeId: string, diags: Diagnostic[]) => void;
  clearNodeDiagnostics: (nodeId: string) => void;
  setEdgeDiagnostics: (edgeId: string, diags: Diagnostic[]) => void;
  clearEdgeDiagnostics: (edgeId: string) => void;
  setChannelDiagnostics: (channelId: string, diags: Diagnostic[]) => void;
  clearChannelDiagnostics: (channelId: string) => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  byNodeId: {},
  byEdgeId: {},
  byChannelId: {},

  setNodeDiagnostics: (nodeId, diags) =>
    set((state) => ({
      byNodeId: { ...state.byNodeId, [nodeId]: diags },
    })),

  clearNodeDiagnostics: (nodeId) =>
    set((state) => {
      const { [nodeId]: _, ...rest } = state.byNodeId;
      return { byNodeId: rest };
    }),

  setEdgeDiagnostics: (edgeId, diags) =>
    set((state) => ({
      byEdgeId: { ...state.byEdgeId, [edgeId]: diags },
    })),

  clearEdgeDiagnostics: (edgeId) =>
    set((state) => {
      const { [edgeId]: _, ...rest } = state.byEdgeId;
      return { byEdgeId: rest };
    }),

  setChannelDiagnostics: (channelId, diags) =>
    set((state) => ({
      byChannelId: { ...state.byChannelId, [channelId]: diags },
    })),

  clearChannelDiagnostics: (channelId) =>
    set((state) => {
      const { [channelId]: _, ...rest } = state.byChannelId;
      return { byChannelId: rest };
    }),
}));
