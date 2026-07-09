// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { history } from "./history";

interface CounterState {
  count: number;
  label: string;
  setCount: (n: number) => void;
}

// A store on DEFAULT config — no custom equality/partialize — so the default
// equality path is what's under test.
function makeStore() {
  return create(
    history<CounterState>()((set) => ({
      count: 0,
      label: "a",
      setCount: (n) => set((s) => ({ ...s, count: n })),
    })),
  );
}

describe("history middleware (default config)", () => {
  let store: ReturnType<typeof makeStore>;
  beforeEach(() => {
    store = makeStore();
  });

  it("withCheckpoint records a checkpoint when the operation changes state", () => {
    store.getState().withCheckpoint(() => store.getState().setCount(1));
    expect(store.getState().count).toBe(1);
    expect(store.getState().canUndo()).toBe(true);

    store.getState().undo();
    expect(store.getState().count).toBe(0);
    expect(store.getState().canRedo()).toBe(true);

    store.getState().redo();
    expect(store.getState().count).toBe(1);
  });

  it("withCheckpoint does NOT record a checkpoint for a no-op", () => {
    store.getState().withCheckpoint(() => {});
    expect(store.getState().canUndo()).toBe(false);
  });

  it("a no-op withCheckpoint preserves the redo stack", () => {
    store.getState().withCheckpoint(() => store.getState().setCount(1));
    store.getState().undo();
    expect(store.getState().canRedo()).toBe(true);

    store.getState().withCheckpoint(() => {});
    expect(store.getState().canRedo()).toBe(true);
  });

  it("a real change clears the redo stack", () => {
    store.getState().withCheckpoint(() => store.getState().setCount(1));
    store.getState().undo();
    store.getState().withCheckpoint(() => store.getState().setCount(7));
    expect(store.getState().canRedo()).toBe(false);
  });

  it("withCheckpoint returns the operation's result and propagates throws without a checkpoint", () => {
    expect(store.getState().withCheckpoint(() => 42)).toBe(42);
    expect(() =>
      store.getState().withCheckpoint(() => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.getState().canUndo()).toBe(false);
  });

  it("mutationCount ticks on checkpointed changes only", () => {
    const before = store.getState().mutationCount;
    store.getState().withCheckpoint(() => {});
    expect(store.getState().mutationCount).toBe(before);
    store.getState().withCheckpoint(() => store.getState().setCount(5));
    expect(store.getState().mutationCount).toBe(before + 1);
  });

  it("takeCheckpoint always records, and clearHistory empties both stacks", () => {
    store.getState().takeCheckpoint();
    expect(store.getState().canUndo()).toBe(true);
    store.getState().clearHistory();
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().canRedo()).toBe(false);
  });
});
