import type { MemoryFileInstance } from "@foresthub/workflow-core/types/memory";
import { useEditorStore } from "../store/editorStore";
import { generateId } from "./IDs";
import { memoryFileKey } from "./memoryFiles";

/** Pick a fresh `memoryN` name that doesn't collide with existing memory files. */
function nextDefaultName(existingNames: string[]): string {
  let counter = 1;
  while (existingNames.includes(`memory${counter}`)) counter++;
  return `memory${counter}`;
}

/** Create a new memory file in the editor store. Returns the new instance. */
export function addMemoryFile(): MemoryFileInstance {
  const uid = generateId("mem");
  const existing = Object.values(useEditorStore.getState().memoryFiles).map((m) => m.name);
  const instance: MemoryFileInstance = {
    uid,
    name: nextDefaultName(existing),
    description: "",
    content: "",
  };
  useEditorStore.getState().setMemoryFiles((files) => ({ ...files, [memoryFileKey(uid)]: instance }));
  return instance;
}

/** Apply a partial patch to a memory file. */
export function updateMemoryFile(uid: string, patch: Partial<Omit<MemoryFileInstance, "uid">>): void {
  const key = memoryFileKey(uid);
  useEditorStore.getState().setMemoryFiles((files) => {
    const existing = files[key];
    if (!existing) return files;
    return {
      ...files,
      [key]: {
        ...existing,
        ...patch,
      },
    };
  });
}

export function deleteMemoryFile(uid: string): void {
  const key = memoryFileKey(uid);
  useEditorStore.getState().setMemoryFiles((files) => {
    const { [key]: _drop, ...rest } = files;
    return rest;
  });
  if (useEditorStore.getState().selectedMemoryFileId === uid) {
    useEditorStore.getState().setSelectedMemoryFileId(null);
  }
}
