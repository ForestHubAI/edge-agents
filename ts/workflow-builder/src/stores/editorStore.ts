import { create } from "zustand";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "./canvasStore";
import type { ChannelInstance } from "@foresthub/workflow-core/channel";
import type { MemoryInstance } from "@foresthub/workflow-core/memory";
import type { ModelInstance, ModelInfo } from "@foresthub/workflow-core/model";

// ---------------------------------------------------------------------------
// Default Channels — every workflow starts pre-initialized with a UART
// port so nodes that need a serial port (SerialRead/Write, OnSerialReceive)
// have something to bind to out of the box. Domain shape only — driverId is
// bound at deploy time from the DeploymentConfig.
// ---------------------------------------------------------------------------

export function createDefaultChannels(): Record<string, ChannelInstance> {
  const uart: ChannelInstance = { id: "uart0", label: "Serial", type: "UART", arguments: {} };
  return { [uart.id]: uart };
}

// BuilderMode + helpers live alongside Props/Handle in ../WorkflowBuilder.tsx
// so the full public contract is in one place. The `import type` below is
// type-only — TypeScript erases it at compile time, so no runtime cycle is
// introduced even though WorkflowBuilder.tsx imports useEditorStore from here.
//
// Re-exported so the 14+ panels that already do
// `import { isReadOnly } from "./stores/editorStore"` keep working unchanged.
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
  /** Currently selected declared model for the right-side ModelConfigPanel. */
  selectedModelId: string | null;
  /**
   * Currently selected declared variable (uid) for the right-side
   * VariableConfigPanel. Canvas-local — resolved against the active canvas
   * store, so it is cleared whenever the active canvas changes.
   */
  selectedVariableUid: string | null;
  // Project-scoped channels (pins, buses) — shared across all canvases
  channels: Record<string, ChannelInstance>;
  // Project-scoped memory primitives (memory files + vector databases) — shared
  // across all canvases, referenced from nodes by id.
  memory: Record<string, MemoryInstance>;
  // Project-scoped declared custom/self-hosted models (channel-like) — referenced
  // from nodes by id, mapped to llmproxy providers at deploy.
  models: Record<string, ModelInstance>;
  // The static model catalog (what the llmproxy supports), supplied by the
  // embedder via WorkflowBuilderProps.models. Not workflow state — config only.
  availableModels: ModelInfo[];
  /**
   * Monotonic counter bumped on project-scoped domain mutations
   * (channels/memory/models). Mirrors `canvasStore.mutationCount` so the
   * builder can fire a single onChange event from either source.
   */
  mutationCount: number;
  setActiveCanvas: (canvasId: string) => void;
  setBuilderMode: (mode: BuilderMode) => void;
  setSelection: (nodeIds: string[], edgeIds: string[]) => void;
  clearSelection: () => void;
  setSelectedChannelId: (id: string | null) => void;
  setSelectedMemoryId: (id: string | null) => void;
  setSelectedModelId: (id: string | null) => void;
  setSelectedVariableUid: (uid: string | null) => void;
  setChannels: (updater: (vars: Record<string, ChannelInstance>) => Record<string, ChannelInstance>) => void;
  setMemory: (updater: (mem: Record<string, MemoryInstance>) => Record<string, MemoryInstance>) => void;
  setModels: (updater: (models: Record<string, ModelInstance>) => Record<string, ModelInstance>) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  activeCanvasId: MAIN_CANVAS_ID,
  builderMode: { type: "edit" },
  selectedNodeIds: [],
  selectedEdgeIds: [],
  selectedChannelId: null,
  selectedMemoryId: null,
  selectedModelId: null,
  selectedVariableUid: null,
  channels: createDefaultChannels(),
  memory: {},
  models: {},
  availableModels: [],
  mutationCount: 0,
  // selectedVariableUid is canvas-local; a uid from the previous canvas would
  // resolve to nothing (or, worse, a collision) on the new one, so drop it.
  setActiveCanvas: (canvasId: string) => set({ activeCanvasId: canvasId, selectedVariableUid: null }),
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
        ? { selectedChannelId: null, selectedMemoryId: null, selectedModelId: null, selectedVariableUid: null }
        : {}),
    }),
  clearSelection: () =>
    set({
      selectedNodeIds: [],
      selectedEdgeIds: [],
      selectedChannelId: null,
      selectedMemoryId: null,
      selectedModelId: null,
      selectedVariableUid: null,
    }),
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
        selectedModelId: id !== null ? null : state.selectedModelId,
        selectedVariableUid: id !== null ? null : state.selectedVariableUid,
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
        selectedModelId: id !== null ? null : state.selectedModelId,
        selectedVariableUid: id !== null ? null : state.selectedVariableUid,
        selectedNodeIds: [],
        selectedEdgeIds: [],
      };
    });
  },
  setSelectedModelId: (id) => {
    set((state) => {
      if (id !== null) {
        const canvas = getOrCreateCanvasStore(state.activeCanvasId).getState();
        canvas.selectNodes([]);
        canvas.selectEdges([]);
      }
      return {
        selectedModelId: id,
        selectedChannelId: id !== null ? null : state.selectedChannelId,
        selectedMemoryId: id !== null ? null : state.selectedMemoryId,
        selectedVariableUid: id !== null ? null : state.selectedVariableUid,
        selectedNodeIds: [],
        selectedEdgeIds: [],
      };
    });
  },
  setSelectedVariableUid: (uid) => {
    set((state) => {
      // Picking a variable behaves like picking a node/edge: drop ReactFlow's
      // visual selection on the active canvas and clear the project-scoped
      // sidebar selections so only the VariableConfigPanel is shown.
      if (uid !== null) {
        const canvas = getOrCreateCanvasStore(state.activeCanvasId).getState();
        canvas.selectNodes([]);
        canvas.selectEdges([]);
      }
      return {
        selectedVariableUid: uid,
        selectedChannelId: uid !== null ? null : state.selectedChannelId,
        selectedMemoryId: uid !== null ? null : state.selectedMemoryId,
        selectedModelId: uid !== null ? null : state.selectedModelId,
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
  setModels: (updater) =>
    set((state) => {
      const next = updater(state.models);
      if (next === state.models) return state;
      return { models: next, mutationCount: state.mutationCount + 1 };
    }),
  // Catalog is config (from props), not workflow content — never bumps mutationCount.
  setAvailableModels: (models) => set({ availableModels: models }),
}));
