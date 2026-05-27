import { create } from "zustand";
import { getCanvasStore, getOrCreateCanvasStore, MAIN_CANVAS_ID } from "./canvasStore";
import type { Channel } from "@foresthubai/workflow-core/channel";
import type { Memory } from "@foresthubai/workflow-core/memory";
import type { Model, ModelInfo } from "@foresthubai/workflow-core/model";

// ---------------------------------------------------------------------------
// Default Channels — every workflow starts pre-initialized with a UART
// port so nodes that need a serial port (SerialRead/Write, OnSerialReceive)
// have something to bind to out of the box. Domain shape only — driverId is
// bound at deploy time from the DeploymentConfig.
// ---------------------------------------------------------------------------

export function createDefaultChannels(): Record<string, Channel> {
  const uart: Channel = { id: "uart0", label: "Serial", type: "UART", arguments: {} };
  return { [uart.id]: uart };
}

import type { BuilderMode } from "../WorkflowBuilder";
// Type-only (erased) — the active left-sidebar tab lives here so non-sidebar code
// (e.g. validation navigation) can open a specific panel. No runtime cycle.
import type { SidebarTab } from "../panels/BuilderSidebar";

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * What the editor is focused on, driving right-side config-panel visibility.
 * A discriminated union so exclusivity is structural: at most one primitive is
 * ever selected, except nodes+edges which coexist under `graph` (box-select can
 * grab both). The only way to mutate it is the select* / clearSelection actions,
 * each of which replaces the whole value — no field can drift out of sync.
 */
export type Selection =
  | { kind: "none" }
  | { kind: "graph"; nodeIds: string[]; edgeIds: string[] }
  | { kind: "channel"; id: string }
  | { kind: "memory"; id: string }
  | { kind: "model"; id: string }
  | { kind: "variable"; uid: string };

const NO_SELECTION: Selection = { kind: "none" };

// Drop ReactFlow's visual selection on a canvas so previously-glowing nodes/edges
// stop glowing. Peek (never create) — clearing selection must not resurrect a
// canvas store that was just dropped (e.g. after clearAllCanvasStores).
function clearCanvasVisualSelection(canvasId: string): void {
  const canvas = getCanvasStore(canvasId)?.getState();
  canvas?.selectNodes([]);
  canvas?.selectEdges([]);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface EditorState {
  activeCanvasId: string;
  activeSidebarTab: SidebarTab;
  builderMode: BuilderMode;
  selection: Selection;
  // Project-scoped channels (pins, buses) — shared across all canvases
  channels: Record<string, Channel>;
  // Project-scoped memory primitives (memory files + vector databases) — shared
  // across all canvases, referenced from nodes by id.
  memory: Record<string, Memory>;
  // Project-scoped declared custom/self-hosted models (channel-like) — referenced
  // from nodes by id, mapped to llmproxy providers at deploy.
  models: Record<string, Model>;
  // The static model catalog (what the llmproxy supports), supplied by the
  // embedder via WorkflowBuilderProps.models. Not workflow state — config only.
  availableModels: ModelInfo[];
  /**
   * Monotonic counter bumped on project-scoped domain mutations
   * (channels/memory/models). Mirrors canvasStores' history mutationCount so the
   * builder can fire a single onChange event from either source.
   */
  mutationCount: number;
  setActiveCanvas: (canvasId: string) => void;
  setBuilderMode: (mode: BuilderMode) => void;
  /** Programmatic graph selection (sidebar/diagnostics): also pushes into ReactFlow. */
  selectGraph: (nodeIds: string[], edgeIds: string[]) => void;
  /** ReactFlow-origin graph selection (onSelectionChange): never pushes back. */
  syncGraphFromCanvas: (nodeIds: string[], edgeIds: string[]) => void;
  selectChannel: (id: string) => void;
  selectMemory: (id: string) => void;
  selectModel: (id: string) => void;
  selectVariable: (uid: string) => void;
  clearSelection: () => void;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  setChannels: (updater: (vars: Record<string, Channel>) => Record<string, Channel>) => void;
  setMemory: (updater: (mem: Record<string, Memory>) => Record<string, Memory>) => void;
  setModels: (updater: (models: Record<string, Model>) => Record<string, Model>) => void;
  setAvailableModels: (models: ModelInfo[]) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeCanvasId: MAIN_CANVAS_ID,
  builderMode: { type: "edit" },
  selection: NO_SELECTION,
  activeSidebarTab: "nodes",
  channels: createDefaultChannels(),
  memory: {},
  models: {},
  availableModels: [],
  mutationCount: 0,
  // A `variable` selection is canvas-local; its uid would resolve to nothing (or,
  // worse, a collision) on the new canvas, so drop it. Project-scoped selections
  // (channel/memory/model) survive the switch.
  setActiveCanvas: (canvasId: string) =>
    set((state) => ({
      activeCanvasId: canvasId,
      selection: state.selection.kind === "variable" ? NO_SELECTION : state.selection,
    })),
  setBuilderMode: (mode: BuilderMode) => set({ builderMode: mode }),
  selectGraph: (nodeIds, edgeIds) => {
    set({ selection: nodeIds.length || edgeIds.length ? { kind: "graph", nodeIds, edgeIds } : NO_SELECTION });
    // Programmatic pick — mirror it into ReactFlow so the canvas reflects it.
    const canvas = getOrCreateCanvasStore(get().activeCanvasId).getState();
    canvas.selectNodes(nodeIds);
    canvas.selectEdges(edgeIds);
  },
  syncGraphFromCanvas: (nodeIds, edgeIds) => {
    if (nodeIds.length || edgeIds.length) {
      set({ selection: { kind: "graph", nodeIds, edgeIds } });
    } else if (get().selection.kind === "graph") {
      // Empty + currently graph = user deselected on the canvas → clear.
      // Empty + any other kind = echo of the canvas-clear we triggered when
      // picking a channel/memory/etc → ignore, or it would wipe that pick.
      set({ selection: NO_SELECTION });
    }
  },
  selectChannel: (id) => {
    set({ selection: { kind: "channel", id } });
    clearCanvasVisualSelection(get().activeCanvasId);
  },
  selectMemory: (id) => {
    set({ selection: { kind: "memory", id } });
    clearCanvasVisualSelection(get().activeCanvasId);
  },
  selectModel: (id) => {
    set({ selection: { kind: "model", id } });
    clearCanvasVisualSelection(get().activeCanvasId);
  },
  selectVariable: (uid) => {
    set({ selection: { kind: "variable", uid } });
    clearCanvasVisualSelection(get().activeCanvasId);
  },
  clearSelection: () => {
    set({ selection: NO_SELECTION });
    clearCanvasVisualSelection(get().activeCanvasId);
  },
  setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
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
