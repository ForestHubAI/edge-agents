// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Leaf module on purpose: BuilderMode is consumed across the whole tree
// (panels, graph, stores), so it must not live in WorkflowBuilder.tsx —
// importing it from there creates module cycles back through the root.

/** BuilderMode steers the overall behavior of the workflow builder. */
export type BuilderMode = { type: "edit" } | { type: "preview" } | { type: "debug" };

/** True when canvas mutations should be blocked (preview or debug). */
export function isReadOnly(mode: BuilderMode): boolean {
  return mode.type !== "edit";
}
