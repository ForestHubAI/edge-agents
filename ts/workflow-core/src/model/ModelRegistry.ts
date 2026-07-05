// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { ModelType } from "./Model";
import type { ModelDefinition } from "./ModelDefinition";
import { LLMModelDefinition } from "./LLMModelDefinition";

/**
 * Central registry for declared (custom) model variant definitions (one per
 * ModelType). Mirrors MemoryRegistry / NodeRegistry.
 */
class ModelDefinitionRegistry {
  private models: Map<ModelType, ModelDefinition> = new Map();
  private initialized = false;

  initialize() {
    if (this.initialized) return;
    this.register(LLMModelDefinition);
    this.initialized = true;
  }

  private register(definition: ModelDefinition) {
    this.models.set(definition.type, definition);
  }

  getAll(): ModelDefinition[] {
    return Array.from(this.models.values());
  }

  getByType(type: ModelType): ModelDefinition | undefined {
    return this.models.get(type);
  }
}

export const ModelRegistry = new ModelDefinitionRegistry();
ModelRegistry.initialize();
