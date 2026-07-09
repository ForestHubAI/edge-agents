// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { Channel } from "../channel";
import type { Memory } from "../memory";
import type { Model } from "../model";
import type { Node } from "../node";
import type { FunctionDeclaration } from "../function";
import type { Edge } from "../edge";
import type { Variable } from "../variable";
import type { Schemas } from "../api";

export type ApiWorkflow = Schemas["Workflow"];

/**
 * The id of the project's main canvas. All other canvas ids identify function
 * definitions. Lives here next to {@link Workflow} (which keys canvases
 * by this value) so the headless validator can reason about canvas scope
 * without depending on a UI store.
 */
export const MAIN_CANVAS_ID = "main" as const;

/**
 * In-memory domain state for a workflow, which the headless validator consumes.
 * NOT a persistence format, NOT the format the editor uses internally (Zustand stores).
 * This format is used as intermediary when importing/exporting to api format and to run validation
 */
export interface Workflow {
  canvases: Record<string, Canvas>;
  functions: Record<string, FunctionDeclaration>;
  channels: Record<string, Channel>;
  memory: Record<string, Memory>;
  models: Record<string, Model>;
}

/**
 * One canvas's worth of in-memory domain state — the body of either the main canvas
 * or a function.
 */
export interface Canvas {
  nodes: Node[];
  edges: Edge[];
  variables: Record<string, Variable>;
}
