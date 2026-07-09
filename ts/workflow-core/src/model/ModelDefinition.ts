// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { Parameter } from "../parameter";
import type { ModelType } from "./Model";

/**
 * Static, per-type metadata for a declared (custom) model variant. Mirrors
 * MemoryDefinition / NodeDefinition: one definition object per ModelType,
 * registered in ModelRegistry. `label` is a top-level instance field (edited
 * like a channel label), so it is never a parameter here.
 */
export interface ModelDefinition {
  type: ModelType;
  label: string;
  description: string;
  parameters: Parameter[];
}
