import { MemoryRegistry, type MemoryType, type MemoryInstance } from "@foresthub/workflow-core/memory";
import { useEditorStore } from "../stores/editorStore";
import { generateId } from "@foresthub/workflow-core/id";

/**
 * Build the initial `arguments` record for a new memory: each parameter of the
 * chosen type that declares a `default` gets seeded.
 */
function defaultArguments(type: MemoryType): Record<string, unknown> {
  const def = MemoryRegistry.getByType(type);
  const args: Record<string, unknown> = {};
  for (const param of def?.parameters ?? []) {
    if ("default" in param && param.default !== undefined) {
      args[param.id] = param.default;
    }
  }
  return args;
}

/** Default label prefix per memory type. */
const LABEL_PREFIX: Record<MemoryType, string> = {
  MemoryFile: "memory",
  VectorDatabase: "vectordb",
};

/** Pick a fresh `<prefix>N` label that doesn't collide with existing memories. */
function nextDefaultLabel(prefix: string, existingLabels: string[]): string {
  let counter = 1;
  while (existingLabels.includes(`${prefix}${counter}`)) counter++;
  return `${prefix}${counter}`;
}

/** Create a new memory primitive of the given type in the editor store. Returns the new instance. */
export function addMemory(type: MemoryType): MemoryInstance {
  const id = generateId();
  const existing = Object.values(useEditorStore.getState().memory).map((m) => m.label);
  const instance: MemoryInstance = {
    id,
    label: nextDefaultLabel(LABEL_PREFIX[type], existing),
    type,
    arguments: defaultArguments(type),
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
