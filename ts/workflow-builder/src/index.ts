// Main component + its contract
export { WorkflowBuilder } from "./WorkflowBuilder";
export type { WorkflowBuilderProps, WorkflowBuilderHandle } from "./WorkflowBuilder";

// Editor mode the embedder constructs and passes via setMode / initialMode
export type { BuilderMode } from "./WorkflowBuilder";
export { isReadOnly, isPreview } from "./WorkflowBuilder";

// Debug phase the embedder pushes from the engine via setDebugPhase
export type { DebugSessionPhase } from "./stores/debugStore";

// Validation types so the embedder can render its own dialog from handle.validate()
export type { ValidationResult, Diagnostic, CanvasValidationResult } from "@foresthub/workflow-core/diagnostics";

// Opt-in: pre-built validation dialog component
export { default as ValidationDialog } from "./dialogs/ValidationDialog";

// Workflow snapshot type that crosses the boundary via loadWorkflow / exportWorkflow
export type { ApiWorkflow as Workflow } from "@foresthub/workflow-core/workflow";
