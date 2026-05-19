import { create } from "zustand";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "./canvasStore";
import type { ChannelInstance } from "@foresthub/workflow-core/types/channel";
import type { MemoryFileInstance } from "@foresthub/workflow-core/types/memory";
import { channelKey } from "../utils/channels";

// ---------------------------------------------------------------------------
// Default Channels — every workflow starts pre-initialized with a UART
// port so nodes that need a serial port (SerialRead/Write, OnSerialReceive)
// have something to bind to out of the box. Domain shape only — driverId is
// bound at deploy time from the DeploymentConfig.
// ---------------------------------------------------------------------------

export function createDefaultChannels(): Record<string, ChannelInstance> {
  const uart: ChannelInstance = { id: "uart0", label: "Serial", type: "UART", arguments: {} };
  return { [channelKey(uart.id)]: uart };
}

// ---------------------------------------------------------------------------
// Builder Mode — unified discriminated union
// ---------------------------------------------------------------------------

export type BuilderMode =
  | { type: "edit" }
  | {
      type: "preview";
      label: string;
      description?: string;
      /** When set, preview is bound to this project (cancel reloads it). */
      projectId?: string;
    }
  | { type: "debug" };

/** True when the builder is not in edit mode (canvas mutations should be blocked). */
export function isReadOnly(mode: BuilderMode): boolean {
  return mode.type !== "edit";
}

/** Type guard for preview mode. */
export function isPreview(mode: BuilderMode): mode is Extract<BuilderMode, { type: "preview" }> {
  return mode.type === "preview";
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface EditorState {
  activeCanvasId: string;
  builderMode: BuilderMode;
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  /** Currently selected channel for the right-side ChannelConfigPanel. */
  selectedChannelId: string | null;
  /** Currently selected memory file for the right-side MemoryFileConfigPanel. */
  selectedMemoryFileId: string | null;
  // Project-scoped channels (pins, buses) — shared across all canvases
  channels: Record<string, ChannelInstance>;
  // Project-scoped memory files — shared across all canvases, referenced from
  // agent nodes by uid.
  memoryFiles: Record<string, MemoryFileInstance>;
  setActiveCanvas: (canvasId: string) => void;
  setBuilderMode: (mode: BuilderMode) => void;
  setSelection: (nodeIds: string[], edgeIds: string[]) => void;
  clearSelection: () => void;
  setSelectedChannelId: (id: string | null) => void;
  setSelectedMemoryFileId: (id: string | null) => void;
  setChannels: (updater: (vars: Record<string, ChannelInstance>) => Record<string, ChannelInstance>) => void;
  setMemoryFiles: (
    updater: (files: Record<string, MemoryFileInstance>) => Record<string, MemoryFileInstance>,
  ) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeCanvasId: MAIN_CANVAS_ID,
  builderMode: { type: "edit" },
  selectedNodeIds: [],
  selectedEdgeIds: [],
  selectedChannelId: null,
  selectedMemoryFileId: null,
  channels: createDefaultChannels(),
  memoryFiles: {},
  setActiveCanvas: (canvasId: string) => set({ activeCanvasId: canvasId }),
  setBuilderMode: (mode: BuilderMode) => set({ builderMode: mode }),
  setSelection: (nodeIds, edgeIds) =>
    // Empty selection from ReactFlow's onSelectionChange can fire as a side
    // effect of clearing the canvas-store selection (e.g. when picking a
    // channel/memory file). Only clobber sidebar selection when this call
    // actually picks something — otherwise it would be wiped immediately.
    set({
      selectedNodeIds: nodeIds,
      selectedEdgeIds: edgeIds,
      ...(nodeIds.length > 0 || edgeIds.length > 0
        ? { selectedChannelId: null, selectedMemoryFileId: null }
        : {}),
    }),
  clearSelection: () =>
    set({ selectedNodeIds: [], selectedEdgeIds: [], selectedChannelId: null, selectedMemoryFileId: null }),
  setSelectedChannelId: (id) => {
    set((state) => {
      // Drop ReactFlow's visual selection on the active canvas so a
      // previously-selected node/edge no longer appears highlighted.
      if (id !== null) {
        const canvas = getOrCreateCanvasStore(state.activeCanvasId).getState();
        canvas.selectNodes([]);
        canvas.selectEdges([]);
      }
      return {
        selectedChannelId: id,
        selectedMemoryFileId: id !== null ? null : state.selectedMemoryFileId,
        selectedNodeIds: [],
        selectedEdgeIds: [],
      };
    });
  },
  setSelectedMemoryFileId: (id) => {
    set((state) => {
      if (id !== null) {
        const canvas = getOrCreateCanvasStore(state.activeCanvasId).getState();
        canvas.selectNodes([]);
        canvas.selectEdges([]);
      }
      return {
        selectedMemoryFileId: id,
        selectedChannelId: id !== null ? null : state.selectedChannelId,
        selectedNodeIds: [],
        selectedEdgeIds: [],
      };
    });
  },
  setChannels: (updater) => set((state) => ({ channels: updater(state.channels) })),
  setMemoryFiles: (updater) => set((state) => ({ memoryFiles: updater(state.memoryFiles) })),
}));
