// @foresthub/workflow-core — public entry point.
//
// SCAFFOLD. The pure validator is extracted from the FE monolith
// (parameterize validateAllCanvases() -> validateWorkflow(serialized),
// pull out the expression checker) IN PLACE under existing FE tests,
// then moved here. It must run headless (Node, no React/DOM).
//
// `npm run codegen` regenerates ./api/generated.ts from the SAME
// /contract/workflow.yaml the Go binding uses. Generated code is
// committed; CI regenerates + diffs to prevent cross-language drift.

export type { components, paths, webhooks, Schemas } from "./api/index.js";

export interface Diagnostic {
  severity: "error" | "warning" | "info";
  category: string;
  nodeId?: string;
  message: string;
  range?: { start: number; end: number };
}

/** Parse + validate a serialized workflow. Pure; no I/O, no stores. */
export function validateWorkflow(_serialized: unknown): Diagnostic[] {
  throw new Error("not implemented: extract from FE diagnostics in place first");
}
