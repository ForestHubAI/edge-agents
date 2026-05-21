import { deserialize } from "./workflow/serialization";
import { validateWorkflowState, type ValidationResult } from "./diagnostics/diagnostics";
import type { Workflow } from "./workflow/snapshots";

/**
 * Validate a workflow against the headless validator. Takes the contract's
 * wire shape (`Workflow`), deserializes to the in-memory domain shape
 * (`WorkflowState`), and delegates to {@link validateWorkflowState}.
 * Pure: no I/O, no Zustand, no React, no DOM. Runnable in Node, a CLI, or
 * a Claude Code skill.
 */
export function validateWorkflow(workflow: Workflow): ValidationResult {
  return validateWorkflowState(deserialize(workflow));
}
