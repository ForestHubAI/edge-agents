import { create } from "zustand";
import { getCanvasStore, getOrCreateCanvasStore, MAIN_CANVAS_ID } from "./canvasStore";
import type { Channel } from "@foresthubai/workflow-core/channel";
import type { Memory } from "@foresthubai/workflow-core/memory";
import type { Model, ModelInfo } from "@foresthubai/workflow-core/model";
import type { FunctionDeclaration } from "@foresthubai/workflow-core/function";

// ---------------------------------------------------------------------------
// Default Channels — every workflow starts pre-initialized with a UART
// port so nodes that need a serial port (SerialRead/Write, OnSerialReceive)
// have something to bind to out of the box. Domain shape only — the driver
// binding is supplied at deploy time via the DeploymentMapping, not here.
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
  | { kind: "function"; id: string }
  | { kind: "variable"; uid: string };

const NO_SELECTION: Selection = { kind: "none" };

// Drop ReactFlow's visual selection on a canvas so previously-glowing nodes/edges
// stop glowing. Peek (never create) — clearing selection must not resurrect a
// canvas store that was just dropped (e.g. after clearAllCanvasStores).
function clearRFselect(canvasId: string): void {
  getCanvasStore(canvasId)?.getState().setRFselect([], []);
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
  // Project-scoped function declarations (signature + bundled output assignments).
  // The body of each lives in the matching canvas store (id === fn.id). Like the
  // other resources above, edits here are NOT undo-tracked.
  functions: Record<string, FunctionDeclaration>;
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
  /** Programmatic graph selection (change selection and pushes into ReactFlow). */
  selectGraph: (nodeIds: string[], edgeIds: string[]) => void;
  /** ReactFlow-origin graph selection fires onSelectionChange which needs to update the editor state without pushing back to ReactFlow. */
  syncSelectionFromRF: (nodeIds: string[], edgeIds: string[]) => void;
  selectChannel: (id: string) => void;
  selectMemory: (id: string) => void;
  selectModel: (id: string) => void;
  /** Select a function AND switch the active canvas to its body (id === canvasId), so
   * the config panel's return-expression editors resolve against the body's scope. */
  selectFunction: (id: string) => void;
  selectVariable: (uid: string) => void;
  clearSelection: () => void;
  setActiveSidebarTab: (tab: SidebarTab) => void;
  setChannels: (updater: (vars: Record<string, Channel>) => Record<string, Channel>) => void;
  setMemory: (updater: (mem: Record<string, Memory>) => Record<string, Memory>) => void;
  setModels: (updater: (models: Record<string, Model>) => Record<string, Model>) => void;
  setFunctions: (updater: (funcs: Record<string, FunctionDeclaration>) => Record<string, FunctionDeclaration>) => void;
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
  functions: {},
  availableModels: [],
  mutationCount: 0,
  // A `variable` selection is canvas-local; its uid would resolve to nothing (or,
  // worse, a collision) on the new canvas, so drop it. A `function` selection is
  // tied to being on that function's body canvas (selectFunction switches to it),
  // so leaving that canvas drops it too — switching INTO a function tab instead
  // routes through selectFunction (see useCanvasTabs.setActiveTabId), not here.
  // Project-scoped channel/memory/model selections survive the switch.
  setActiveCanvas: (canvasId: string) =>
    set((state) => ({
      activeCanvasId: canvasId,
      selection:
        state.selection.kind === "variable" || state.selection.kind === "function" ? NO_SELECTION : state.selection,
    })),
  setBuilderMode: (mode: BuilderMode) => set({ builderMode: mode }),
  selectGraph: (nodeIds, edgeIds) => {
    set({ selection: nodeIds.length || edgeIds.length ? { kind: "graph", nodeIds, edgeIds } : NO_SELECTION });
    // Programmatic pick — mirror it into ReactFlow so the canvas reflects it.
    getOrCreateCanvasStore(get().activeCanvasId).getState().setRFselect(nodeIds, edgeIds);
  },
  syncSelectionFromRF: (nodeIds, edgeIds) => {
    if (nodeIds.length || edgeIds.length) {
      // A selection made on the canvas (click, box-drag) is hoisted into the editor state.
      // A programmatic selectGraph also round-trips here via onSelectionChange; that just re-sets an
      // equal value (one benign re-render), so it needs no special-casing.
      set({ selection: { kind: "graph", nodeIds, edgeIds } });
    } else if (get().selection.kind === "graph") {
      // Empty while a graph selection was active = user deselected on the canvas.
      set({ selection: NO_SELECTION });
    }
    // Empty + non-graph kind = echo of the canvas-clear we triggered when picking
    // a channel/memory/etc; ignore it, or it would wipe that pick.
  },
  selectChannel: (id) => {
    set({ selection: { kind: "channel", id } });
    clearRFselect(get().activeCanvasId);
  },
  selectMemory: (id) => {
    set({ selection: { kind: "memory", id } });
    clearRFselect(get().activeCanvasId);
  },
  selectModel: (id) => {
    set({ selection: { kind: "model", id } });
    clearRFselect(get().activeCanvasId);
  },
  selectFunction: (id) => {
    // Drop the outgoing canvas's RF selection, then focus the function: select it
    // AND make its body the active canvas so the config panel's expression editors
    // resolve against the function's local variable scope.
    clearRFselect(get().activeCanvasId);
    set({ selection: { kind: "function", id }, activeCanvasId: id });
  },
  selectVariable: (uid) => {
    set({ selection: { kind: "variable", uid } });
    clearRFselect(get().activeCanvasId);
  },
  clearSelection: () => {
    set({ selection: NO_SELECTION });
    clearRFselect(get().activeCanvasId);
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
  setFunctions: (updater) =>
    set((state) => {
      const next = updater(state.functions);
      if (next === state.functions) return state;
      return { functions: next, mutationCount: state.mutationCount + 1 };
    }),
  // Catalog is config (from props), not workflow content — never bumps mutationCount.
  setAvailableModels: (models) => set({ availableModels: models }),
}));
