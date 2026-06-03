import type { Expression } from "@foresthubai/workflow-core";
import type { DataType } from "@foresthubai/workflow-core/parameter";
import type { FunctionDeclaration } from "@foresthubai/workflow-core/function";
import { generateId } from "@foresthubai/workflow-core/id";
import { ensureUid, type ApiVariable } from "@foresthubai/workflow-core/variable";
import { useEditorStore } from "../stores/editorStore";
import {
  getCanvasStore,
  getOrCreateCanvasStore,
  deleteCanvasStore,
  syncFunctionArgVariables,
  notifyCanvasRegistryChange,
} from "../stores/canvasStore";
import { uniqueName } from "./resourceHelpers";

/**
 * Functions are a project-scoped resource: the declaration ({@link FunctionDeclaration}
 * — signature + bundled output assignments) lives in editorStore, the body lives in
 * the matching canvas store (id === fn.id). These operations keep the two in sync.
 * Like channel/memory/model operations they write straight to the store (no undo
 * history). A declaration change (name/arguments/outputs) forward-reconciles call
 * sites via the migration subscription; an output *expression* edit does not (call
 * sites never see the callee's expressions), so it doesn't bump the version.
 */

const emptyExpression = (dataType: DataType): Expression => ({ expression: "", references: [], dataType });

/** Re-derive the body's fnarg variables from the declaration's current arguments. */
function syncBody(fn: FunctionDeclaration): void {
  const store = getCanvasStore(fn.id);
  if (store) syncFunctionArgVariables(store, fn.arguments);
}

/**
 * Apply an update to one function. `bumpVersion` is true for signature changes
 * (name/arguments/outputs declaration) so call sites detect staleness, and false for
 * pure output-expression edits. Version-bumping changes re-sync the body's fnargs.
 */
function mutate(id: string, updater: (fn: FunctionDeclaration) => FunctionDeclaration, bumpVersion: boolean): void {
  let next: FunctionDeclaration | undefined;
  useEditorStore.getState().setFunctions((fns) => {
    const fn = fns[id];
    if (!fn) return fns;
    const updated = updater(fn);
    next = bumpVersion ? { ...updated, version: fn.version + 1 } : updated;
    return { ...fns, [id]: next };
  });
  if (next && bumpVersion) syncBody(next);
}

/** Create a new (empty) function + its body canvas. Returns the new definition. */
export function addFunction(): FunctionDeclaration {
  const id = generateId();
  const existing = Object.values(useEditorStore.getState().functions).map((f) => f.name);
  const fn: FunctionDeclaration = {
    id,
    version: 1,
    name: uniqueName("function", existing),
    arguments: [],
    outputs: [],
  };
  useEditorStore.getState().setFunctions((fns) => ({ ...fns, [id]: fn }));
  // Create the body canvas (seeds an OnFunctionCall node) and watch it.
  getOrCreateCanvasStore(id);
  notifyCanvasRegistryChange();
  return fn;
}

/** Delete a function: its declaration, its body canvas, and any selection of it. */
export function deleteFunction(id: string): void {
  useEditorStore.getState().setFunctions((fns) => {
    const { [id]: _drop, ...rest } = fns;
    return rest;
  });
  deleteCanvasStore(id);
  const sel = useEditorStore.getState().selection;
  if (sel.kind === "function" && sel.id === id) {
    useEditorStore.getState().clearSelection();
  }
}

/** Rename a function. Call-site migration detects this via the name comparison, so
 *  it needs no version bump. */
export function renameFunction(id: string, name: string): void {
  mutate(id, (fn) => ({ ...fn, name }), false);
}

// ── Input arguments (declarations) ─────────────────────────────────────────────

export function addArgument(id: string): void {
  mutate(
    id,
    (fn) => ({
      ...fn,
      arguments: [...fn.arguments, ensureUid({ name: `input${fn.arguments.length + 1}`, dataType: "string" })],
    }),
    true,
  );
}

export function updateArgument(id: string, index: number, patch: Partial<ApiVariable>): void {
  mutate(
    id,
    (fn) => {
      const existing = fn.arguments[index];
      if (!existing) return fn;
      const next = [...fn.arguments];
      next[index] = { ...existing, ...patch };
      return { ...fn, arguments: next };
    },
    true,
  );
}

export function removeArgument(id: string, index: number): void {
  mutate(id, (fn) => ({ ...fn, arguments: fn.arguments.filter((_, i) => i !== index) }), true);
}

// ── Outputs (declaration + assignment bundled) ─────────────────────────────────

export function addOutput(id: string): void {
  mutate(
    id,
    (fn) => {
      const dataType: DataType = "string";
      return {
        ...fn,
        outputs: [...fn.outputs, { uid: generateId(), name: `output${fn.outputs.length + 1}`, dataType, expression: emptyExpression(dataType) }],
      };
    },
    true,
  );
}

/** Update an output's declaration (name/dataType). A dataType change retags the
 *  bundled expression's dataType but keeps the entered text. */
export function updateOutput(id: string, index: number, patch: { name?: string; dataType?: DataType }): void {
  mutate(
    id,
    (fn) => {
      const existing = fn.outputs[index];
      if (!existing) return fn;
      const dataType = patch.dataType ?? existing.dataType;
      const next = [...fn.outputs];
      next[index] = {
        ...existing,
        ...patch,
        dataType,
        expression: patch.dataType ? { ...existing.expression, dataType } : existing.expression,
      };
      return { ...fn, outputs: next };
    },
    true,
  );
}

export function removeOutput(id: string, index: number): void {
  mutate(id, (fn) => ({ ...fn, outputs: fn.outputs.filter((_, i) => i !== index) }), true);
}

/** Set one output's return-value expression. Not a signature change → no version bump. */
export function setOutputExpression(id: string, index: number, expression: Expression): void {
  mutate(
    id,
    (fn) => {
      const existing = fn.outputs[index];
      if (!existing) return fn;
      const next = [...fn.outputs];
      next[index] = { ...existing, expression };
      return { ...fn, outputs: next };
    },
    false,
  );
}

/** Read a function declaration without subscribing (for non-component callers). */
export function getFunction(id: string): FunctionDeclaration | undefined {
  return useEditorStore.getState().functions[id];
}
