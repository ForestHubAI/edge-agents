import { MemoryRegistry, type MemoryType, type MemoryInstance } from "@foresthub/workflow-core/memory";
import { useEditorStore } from "../stores/editorStore";
import { generateId } from "@foresthub/workflow-core/id";
import { seedDefaultArguments, nextDefaultLabel } from "./resourceHelpers";

/** Default label prefix per memory type. */
const LABEL_PREFIX: Record<MemoryType, string> = {
  MemoryFile: "memory",
  VectorDatabase: "vectordb",
};

/** Create a new memory primitive of the given type in the editor store. Returns the new instance. */
export function addMemory(type: MemoryType): MemoryInstance {
  const id = generateId();
  const existing = Object.values(useEditorStore.getState().memory).map((m) => m.label);
  const instance: MemoryInstance = {
    id,
    label: nextDefaultLabel(LABEL_PREFIX[type], existing),
    type,
    arguments: seedDefaultArguments(MemoryRegistry.getByType(type)?.parameters ?? []),
  };
  useEditorStore.getState().setMemory((mem) => ({ ...mem, [id]: instance }));
  return instance;
}

/**
 * Apply a partial patch to a memory primitive. Top-level `label` and the
 * `arguments` record are merged separately. The `type` discriminator is fixed
 * at creation (the user picks a type when adding), so it is never patched here.
 */
export function updateMemory(id: string, patch: { label?: string; arguments?: Record<string, unknown> }): void {
  const key = id;
  useEditorStore.getState().setMemory((mem) => {
    const existing = mem[key];
    if (!existing) return mem;
    return {
      ...mem,
      [key]: {
        ...existing,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.arguments ? { arguments: { ...existing.arguments, ...patch.arguments } } : {}),
      },
    };
  });
}

export function deleteMemory(id: string): void {
  const key = id;
  useEditorStore.getState().setMemory((mem) => {
    const { [key]: _drop, ...rest } = mem;
    return rest;
  });
  if (useEditorStore.getState().selectedMemoryId === id) {
    useEditorStore.getState().setSelectedMemoryId(null);
  }
}
