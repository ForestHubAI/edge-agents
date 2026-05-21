/**
 * diagnosticsStore.ts
 *
 * This Zustand store manages diagnostics (errors and warnings) for the currently active canvas
 * in the workflow builder. It holds diagnostics for nodes and edges, keyed by their IDs.
 *
 * Key design points:
 * - Only diagnostics for the active canvas are stored (flat, not per-canvas).
 * - Diagnostics are written by node/edge components via useEffect, and cleared on unmount.
 * - On canvas switch, the store is cleared and repopulated for the new canvas.
 * - Used for real-time UI feedback (badges, warnings) in the workflow builder.
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
   * which is mounted once at the workflow builder root.
   */
  byChannelId: Record<string, Diagnostic[]>;
  /**
   * Memory primitives are project-scoped like channels. Written by
   * MemoryDiagnosticsSync, mounted once at the workflow builder root.
   */
  byMemoryId: Record<string, Diagnostic[]>;
  /**
   * Declared models are project-scoped like channels/memory. Written by
   * ModelDiagnosticsSync, mounted once at the workflow builder root.
   */
  byModelId: Record<string, Diagnostic[]>;
  setNodeDiagnostics: (nodeId: string, diags: Diagnostic[]) => void;
  clearNodeDiagnostics: (nodeId: string) => void;
  setEdgeDiagnostics: (edgeId: string, diags: Diagnostic[]) => void;
  clearEdgeDiagnostics: (edgeId: string) => void;
  setChannelDiagnostics: (channelId: string, diags: Diagnostic[]) => void;
  clearChannelDiagnostics: (channelId: string) => void;
  setMemoryDiagnostics: (memoryId: string, diags: Diagnostic[]) => void;
  clearMemoryDiagnostics: (memoryId: string) => void;
  setModelDiagnostics: (modelId: string, diags: Diagnostic[]) => void;
  clearModelDiagnostics: (modelId: string) => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  byNodeId: {},
  byEdgeId: {},
  byChannelId: {},
  byMemoryId: {},
  byModelId: {},

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

  setMemoryDiagnostics: (memoryId, diags) =>
    set((state) => ({
      byMemoryId: { ...state.byMemoryId, [memoryId]: diags },
    })),

  clearMemoryDiagnostics: (memoryId) =>
    set((state) => {
      const { [memoryId]: _, ...rest } = state.byMemoryId;
      return { byMemoryId: rest };
    }),

  setModelDiagnostics: (modelId, diags) =>
    set((state) => ({
      byModelId: { ...state.byModelId, [modelId]: diags },
    })),

  clearModelDiagnostics: (modelId) =>
    set((state) => {
      const { [modelId]: _, ...rest } = state.byModelId;
      return { byModelId: rest };
    }),
}));
