// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { MemoryRegistry, type MemoryType, type Memory } from "@foresthubai/workflow-core/memory";
import { useEditorStore } from "../stores/editorStore";
import { generateId } from "@foresthubai/workflow-core/id";
import { seedDefaultArguments, uniqueName } from "./resourceHelpers";

/** Default label prefix per memory type. */
const LABEL_PREFIX: Record<MemoryType, string> = {
  MemoryFile: "memory",
  VectorDatabase: "vectordb",
};

/** Create a new memory primitive of the given type in the editor store. Returns the new instance. */
export function addMemory(type: MemoryType): Memory {
  const id = generateId();
  const existing = Object.values(useEditorStore.getState().memory).map((m) => m.label);
  const instance: Memory = {
    id,
    label: uniqueName(LABEL_PREFIX[type], existing),
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
  const sel = useEditorStore.getState().selection;
  if (sel.kind === "memory" && sel.id === id) {
    useEditorStore.getState().clearSelection();
  }
}
