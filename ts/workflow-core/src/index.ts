import { deserialize } from "./workflow/serialization";
import { validateWorkflowState, type ValidationResult } from "./diagnostics/diagnostics";
import type { ApiWorkflow } from "./workflow/Workflow";

// Api-layer types consumers use directly (no domain twin). Sourced from `api`
// so they're available at the package root rather than via a domain subpath.
export type { DataType, Reference, Expression, FunctionInfo } from "./api";

/**
 * Validate a workflow against the headless validator.
 * Pure: no I/O, no Zustand, no React, no DOM. Runnable in Node, a CLI, or
 * a Claude Code skill.
 */
export function validateWorkflow(workflow: ApiWorkflow): ValidationResult {
  return validateWorkflowState(deserialize(workflow));
}
