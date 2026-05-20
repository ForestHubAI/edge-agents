// @foresthub/workflow-core — public entry point.
//
// One persistence format throughout: the OpenAPI contract `Schemas["Workflow"]`
// from /contract/workflow.yaml. Same wire shape the Go binding consumes.
// `npm run generate` regenerates ./api/workflow.ts; commit + diff in CI to
// keep TS and Go in lockstep.
//
// Two validator entries:
//   - validateWorkflow(workflow)        — takes contract JSON, deserializes
//                                          internally; what the CLI calls.
//   - validateWorkflowState(state)      — takes the in-memory domain shape;
//                                          what the editor's live-diagnostics
//                                          path calls (no double roundtrip).

import { deserialize } from "./workflow/serialization.js";
import { validateWorkflowState, type ValidationResult } from "./diagnostics/diagnostics.js";
import type { Schemas } from "./api/index.js";

export type { components, Schemas } from "./api/index.js";

/**
 * Validate a workflow against the headless validator. Takes the contract's
 * wire shape (`Schemas["Workflow"]`), deserializes to the in-memory domain
 * shape (`WorkflowState`), and delegates to {@link validateWorkflowState}.
 * Pure: no I/O, no Zustand, no React, no DOM. Runnable in Node, a CLI, or
 * a Claude Code skill.
 */
export function validateWorkflow(workflow: Schemas["Workflow"]): ValidationResult {
  return validateWorkflowState(deserialize(workflow));
}
