import { create } from "zustand";

// ---------------------------------------------------------------------------
// Session Phase State Machine
// ---------------------------------------------------------------------------

export type DebugSessionPhase =
  | { status: "inactive" }
  | { status: "building"; abortController: AbortController }
  | { status: "idle"; sessionId: string }
  | { status: "paused"; sessionId: string; cursorNodeId: string }
  | { status: "stepping"; sessionId: string; cursorNodeId: string }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Console
// ---------------------------------------------------------------------------

export interface ConsoleEntry {
  id: number;
  timestamp: number;
  type: "message" | "error" | "system";
  text: string;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface DebugState {
  phase: DebugSessionPhase;
  /** Workflow variable values — client-owned, sent with each step request */
  context: Record<string, unknown>;
  console: ConsoleEntry[];
  nextConsoleId: number;

  // Actions
  setPhase: (phase: DebugSessionPhase) => void;
  setContext: (ctx: Record<string, unknown>) => void;
  updateContextVar: (key: string, value: unknown) => void;
  appendConsole: (type: ConsoleEntry["type"], text: string) => void;
  clearConsole: () => void;
  reset: () => void;
}

export const useDebugStore = create<DebugState>((set) => ({
  phase: { status: "inactive" },
  context: {},
  console: [],
  nextConsoleId: 0,

  setPhase: (phase) => set({ phase }),

  setContext: (ctx) => set({ context: ctx }),

  updateContextVar: (key, value) =>
    set((s) => ({ context: { ...s.context, [key]: value } })),

  appendConsole: (type, text) =>
    set((s) => ({
      console: [...s.console, { id: s.nextConsoleId, timestamp: Date.now(), type, text }],
      nextConsoleId: s.nextConsoleId + 1,
    })),

  clearConsole: () => set({ console: [], nextConsoleId: 0 }),

  reset: () =>
    set({
      phase: { status: "inactive" },
      context: {},
      console: [],
      nextConsoleId: 0,
    }),
}));
