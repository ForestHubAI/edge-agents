import { deserialize } from "./workflow/serialization";
import { validateWorkflowState, type ValidationResult } from "./diagnostics/diagnostics";
import type { ApiWorkflow } from "./workflow/Workflow";

// Api-layer types consumers use directly (no domain twin). Sourced from `api`
// so they're available at the package root rather than via a domain subpath.
// (`FunctionInfo` is the exception — it's the flat twin of the domain
// `FunctionDeclaration`, so it lives on the `function` subpath, not here.)
export type { DataType, Reference, Expression } from "./api";

// Format versioning: load persisted documents through `migrate` before
// deserializing.
export { migrate, CURRENT_SCHEMA_VERSION } from "./migration";

/**
 * Validate a workflow against the headless validator.
 * Pure: no I/O, no Zustand, no React, no DOM. Runnable in Node, a CLI, or
 * a Claude Code skill.
 */
export function validateWorkflow(workflow: ApiWorkflow): ValidationResult {
  return validateWorkflowState(deserialize(workflow));
}
