import { afterEach, describe, expect, it } from "vitest";
import {
  clearAllCanvasStores,
  getAllCanvasStores,
  getCanvasStore,
  getOrCreateCanvasStore,
  subscribeFunctionInfoChanges,
  MAIN_CANVAS_ID,
} from "./canvasStore";

// Reset the module-level registry between tests (it's a singleton).
afterEach(() => clearAllCanvasStores());

describe("clearAllCanvasStores", () => {
  it("re-seeds an empty main canvas and drops the rest", () => {
    const mainBefore = getOrCreateCanvasStore(MAIN_CANVAS_ID);
    getOrCreateCanvasStore("fn-1"); // a function canvas
    expect(Object.keys(getAllCanvasStores())).toEqual(expect.arrayContaining([MAIN_CANVAS_ID, "fn-1"]));

    clearAllCanvasStores();

    const mainAfter = getCanvasStore(MAIN_CANVAS_ID);
    expect(mainAfter).toBeDefined(); // "main always exists" invariant holds
    expect(mainAfter).not.toBe(mainBefore); // it's a fresh, empty instance
    expect(mainAfter?.getState().nodes).toEqual([]);
    expect(getCanvasStore("fn-1")).toBeUndefined(); // function canvas removed
  });

  it("notifies registry listeners with main already present", () => {
    // Regression guard: the notification must fire AFTER main is re-seeded, not
    // while the registry is empty — otherwise subscribers (onChange / history)
    // snapshot an empty set and never re-attach to the recreated main canvas, so
    // edits after New/clear wouldn't mark the workflow dirty.
    let mainPresentAtNotify = false;
    const unsubscribe = subscribeFunctionInfoChanges(() => {
      mainPresentAtNotify = MAIN_CANVAS_ID in getAllCanvasStores();
    });

    clearAllCanvasStores();
    unsubscribe();

    expect(mainPresentAtNotify).toBe(true);
  });
});
