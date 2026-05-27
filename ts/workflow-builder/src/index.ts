// Main component + its contract
export { WorkflowBuilder } from "./WorkflowBuilder";
export type { WorkflowBuilderProps, WorkflowBuilderHandle } from "./WorkflowBuilder";

// Editor mode the embedder constructs and passes via setMode / initialMode
export type { BuilderMode } from "./WorkflowBuilder";
export { isReadOnly, isPreview } from "./WorkflowBuilder";

// Debug phase the embedder pushes from the engine via setDebugPhase
export type { DebugSessionPhase } from "./stores/debugStore";

// Validation result types. handle.validate() presents results itself (toast when
// clean, the dialog below otherwise); these are exported for embedder-side tooling.
export type { ValidationResult, Diagnostic, CanvasValidationResult } from "@foresthubai/workflow-core/diagnostics";

// The validation dialog the builder renders on validate(). Also exported for
// embedders that drive their own validation flow.
export { default as ValidationDialog } from "./dialogs/ValidationDialog";

// Post a toast to the builder's notification surface. The builder mounts its own
// <Toaster> (for internal notices like singleton-node rejection); exporting this
// lets the embedder render host-level notices (save/load errors) in the SAME
// toaster, so they share one style and one surface. shadcn API:
// toast({ title, description?, variant?: "default" | "destructive" }).
export { toast } from "./hooks/use-toast";

// Workflow snapshot type that crosses the boundary via loadWorkflow / exportWorkflow
export type { ApiWorkflow as Workflow } from "@foresthubai/workflow-core/workflow";
