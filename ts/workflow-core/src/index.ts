import { deserialize } from "./workflow/serialization";
import { validateWorkflowState, type ValidationResult } from "./diagnostics/diagnostics";
import type { ApiWorkflow } from "./workflow/Workflow";

/**
 * Validate a workflow against the headless validator.
 * Pure: no I/O, no Zustand, no React, no DOM. Runnable in Node, a CLI, or
 * a Claude Code skill.
 */
export function validateWorkflow(workflow: ApiWorkflow): ValidationResult {
  return validateWorkflowState(deserialize(workflow));
}
