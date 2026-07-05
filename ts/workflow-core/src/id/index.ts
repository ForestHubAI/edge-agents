// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

/**
 * Centralized UID creation for every entity in a workflow — nodes, edges,
 * channels, memory, models, declared variables, function arguments, and
 * function canvases. IDs are opaque.
 */
export function generateId(): string {
  return crypto.randomUUID();
}
