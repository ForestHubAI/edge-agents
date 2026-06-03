import { declaredVarKey, type DeclaredVariable } from "@foresthubai/workflow-core/variable";
import type { DataType } from "@foresthubai/workflow-core";
import { getOrCreateCanvasStore } from "../stores/canvasStore";
import { useEditorStore } from "../stores/editorStore";
import { generateId } from "@foresthubai/workflow-core/id";

/**
 * Per-canvas mutation helpers for declared variables. Mirrors
 * utils/modelOperations.ts, but declared variables are canvas-scoped (they live
 * in canvasStore.variables, not editorStore), so every helper takes a canvasId.
 *
 * Each write takes a history checkpoint first, matching the inline editor it
 * replaces, so a single edit is one undo step.
 */

/** Pick a fresh `var<N>` name that doesn't collide with existing declared variables. */
function nextDefaultName(existingNames: string[]): string {
  let counter = 1;
  while (existingNames.includes(`var${counter}`)) counter++;
  return `var${counter}`;
}

/** Create a new declared variable on the given canvas. Returns its uid. */
export function addDeclaredVariable(canvasId: string): string {
  const store = getOrCreateCanvasStore(canvasId);
  store.takeCheckpoint();
  const existingNames = Object.values(store.getState().variables)
    .filter((v): v is DeclaredVariable => v.kind === "declared")
    .map((v) => v.name);
  const uid = generateId();
  const newVar: DeclaredVariable = {
    kind: "declared",
    uid,
    name: nextDefaultName(existingNames),
    dataType: "int",
  };
  store.getState().setVariables((vars) => ({ ...vars, [declaredVarKey(uid)]: newVar }));
  return uid;
}

/** Apply a partial patch to a declared variable. `kind`/`uid` are fixed. */
export function updateDeclaredVariable(canvasId: string, uid: string, updates: Partial<Omit<DeclaredVariable, "kind" | "uid">>): void {
  const store = getOrCreateCanvasStore(canvasId);
  store.takeCheckpoint();
  const key = declaredVarKey(uid);
  store.getState().setVariables((vars) => {
    const existing = vars[key];
    if (!existing || existing.kind !== "declared") return vars;
    return { ...vars, [key]: { ...existing, ...updates } };
  });
}

/**
 * Change a declared variable's dataType. The previous initialValue is dropped —
 * a value entered for one type rarely makes sense for another, so we reset
 * rather than attempt a lossy coercion.
 */
export function setDeclaredVariableType(canvasId: string, uid: string, dataType: DataType): void {
  updateDeclaredVariable(canvasId, uid, { dataType, initialValue: undefined });
}

/** Delete a declared variable and clear its selection if it was open. */
export function deleteDeclaredVariable(canvasId: string, uid: string): void {
  const store = getOrCreateCanvasStore(canvasId);
  store.takeCheckpoint();
  const key = declaredVarKey(uid);
  store.getState().setVariables((vars) => {
    const { [key]: _drop, ...rest } = vars;
    return rest;
  });
  const sel = useEditorStore.getState().selection;
  if (sel.kind === "variable" && sel.uid === uid) {
    useEditorStore.getState().clearSelection();
  }
}
