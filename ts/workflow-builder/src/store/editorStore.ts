import { create } from "zustand";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "./canvasStore";
import type { ChannelInstance } from "@foresthub/workflow-core/channel";
import type { MemoryInstance } from "@foresthub/workflow-core/memory";
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

// BuilderMode + helpers live alongside Props/Handle in ../WorkflowBuilder.tsx
// so the full public contract is in one place. The `import type` below is
// type-only — TypeScript erases it at compile time, so no runtime cycle is
// introduced even though WorkflowBuilder.tsx imports useEditorStore from here.
//
// Re-exported so the 14+ panels that already do
// `import { isReadOnly } from "./store/editorStore"` keep working unchanged.
export { isReadOnly, isPreview, type BuilderMode } from "../WorkflowBuilder";
import type { BuilderMode } from "../WorkflowBuilder";

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
  /** Currently selected memory primitive for the right-side MemoryConfigPanel. */
  selectedMemoryId: string | null;
  // Project-scoped channels (pins, buses) — shared across all canvases
  channels: Record<string, ChannelInstance>;
  // Project-scoped memory primitives (memory files + vector databases) — shared
  // across all canvases, referenced from nodes by id.
  memory: Record<string, MemoryInstance>;
  /**
   * Monotonic counter bumped on project-scoped domain mutations
   * (channels/memory). Mirrors `canvasStore.mutationCount` so the
   * builder can fire a single onChange event from either source.
   */
  mutationCount: number;
  setActiveCanvas: (canvasId: string) => void;
  setBuilderMode: (mode: BuilderMode) => void;
  setSelection: (nodeIds: string[], edgeIds: string[]) => void;
  clearSelection: () => void;
  setSelectedChannelId: (id: string | null) => void;
  setSelectedMemoryId: (id: string | null) => void;
  setChannels: (updater: (vars: Record<string, ChannelInstance>) => Record<string, ChannelInstance>) => void;
  setMemory: (updater: (mem: Record<string, MemoryInstance>) => Record<string, MemoryInstance>) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeCanvasId: MAIN_CANVAS_ID,
  builderMode: { type: "edit" },
  selectedNodeIds: [],
  selectedEdgeIds: [],
  selectedChannelId: null,
  selectedMemoryId: null,
  channels: createDefaultChannels(),
  memory: {},
  mutationCount: 0,
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
        ? { selectedChannelId: null, selectedMemoryId: null }
        : {}),
    }),
  clearSelection: () =>
    set({ selectedNodeIds: [], selectedEdgeIds: [], selectedChannelId: null, selectedMemoryId: null }),
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
        selectedMemoryId: id !== null ? null : state.selectedMemoryId,
        selectedNodeIds: [],
        selectedEdgeIds: [],
      };
    });
  },
  setSelectedMemoryId: (id) => {
    set((state) => {
      if (id !== null) {
        const canvas = getOrCreateCanvasStore(state.activeCanvasId).getState();
        canvas.selectNodes([]);
        canvas.selectEdges([]);
      }
      return {
        selectedMemoryId: id,
        selectedChannelId: id !== null ? null : state.selectedChannelId,
        selectedNodeIds: [],
        selectedEdgeIds: [],
      };
    });
  },
  setChannels: (updater) =>
    set((state) => {
      const next = updater(state.channels);
      if (next === state.channels) return state;
      return { channels: next, mutationCount: state.mutationCount + 1 };
    }),
  setMemory: (updater) =>
    set((state) => {
      const next = updater(state.memory);
      if (next === state.memory) return state;
      return { memory: next, mutationCount: state.mutationCount + 1 };
    }),
}));
