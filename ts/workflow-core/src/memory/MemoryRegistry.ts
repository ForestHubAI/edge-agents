// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { MemoryType } from "./Memory";
import type { MemoryDefinition } from "./MemoryDefinition";
import { MemoryFileDefinition } from "./MemoryFileDefinition";
import { VectorDatabaseDefinition } from "./VectorDatabaseDefinition";

/**
 * Central registry for memory variant definitions (one per MemoryType).
 * Mirrors NodeRegistry.
 */
class MemoryDefinitionRegistry {
  private memories: Map<MemoryType, MemoryDefinition> = new Map();
  private initialized = false;

  initialize() {
    if (this.initialized) return;
    this.register(MemoryFileDefinition);
    this.register(VectorDatabaseDefinition);
    this.initialized = true;
  }

  private register(definition: MemoryDefinition) {
    this.memories.set(definition.type, definition);
  }

  getAll(): MemoryDefinition[] {
    return Array.from(this.memories.values());
  }

  getByType(type: MemoryType): MemoryDefinition | undefined {
    return this.memories.get(type);
  }
}

export const MemoryRegistry = new MemoryDefinitionRegistry();
MemoryRegistry.initialize();
