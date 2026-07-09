// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { Parameter } from "../parameter";
import type { MemoryType } from "./Memory";

/**
 * Static, per-type metadata for a memory variant. Mirrors NodeDefinition:
 * one definition object per MemoryType, registered in MemoryRegistry — unlike
 * channels, which use a single union definition gated by activation rules.
 * `label` is a top-level instance field (edited like a channel label), so it is
 * never a parameter here.
 */
export interface MemoryDefinition {
  type: MemoryType;
  label: string;
  description: string;
  parameters: Parameter[];
}
