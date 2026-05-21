import type { ChannelInstance } from "../channel";
import type { MemoryInstance } from "../memory";
import type { ModelInstance } from "../model";
import type { NodeInstance, FunctionInfo, Expression } from "../node";
import type { EdgeInstance } from "../edge";
import type { CanvasVariable } from "../variable";
import type { Schemas } from "../api";

/**
 * The id of the project's main canvas. All other canvas ids identify function
 * definitions. Lives here next to {@link WorkflowState} (which keys canvases
 * by this value) so the headless validator can reason about canvas scope
 * without depending on a UI store.
 */
export const MAIN_CANVAS_ID = "main" as const;

/**
 * One canvas's worth of in-memory domain state. The outer `type` on each
 * node is the domain node type (e.g. "Agent"); the React Flow display type
 * is editor-only and lives in workflow-builder's store wrapper.
 */
export interface CanvasData {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: NodeInstance;
  }>;
  edges: Array<{
    id: string;
    type?: string;
    source: string;
    sourceHandle?: string | null;
    target: string;
    targetHandle?: string | null;
    data?: EdgeInstance;
  }>;
  variables: Record<string, CanvasVariable>;
  functionInfo: FunctionInfo | null;
  outputAssignments: Record<string, Expression>;
}

/**
 * The contract's on-wire workflow shape — the single persistence format
 * (`Schemas["Workflow"]` from /contract/workflow.yaml). Exposed as a domain
 * alias so consumers import `Workflow` from `@foresthub/workflow-core/workflow`
 * and never reach into the api layer. `serialize`/`deserialize` (in
 * ./serialization) convert between this and the in-memory {@link WorkflowState}.
 */
export type Workflow = Schemas["Workflow"];

/**
 * In-memory domain workflow state — the shape the headless validator consumes.
 *
 * NOT a persistence format: this lives only in memory. Persisted JSON uses the
 * contract `Schemas["Workflow"]`; `serialize(state)`/`deserialize(workflow)` in
 * `./workflowSerialization` convert between the two. Two producers feed this
 * shape: the editor reads it from live Zustand stores; the CLI calls
 * `deserialize(contractWorkflow)` after parsing JSON.
 *
 * Channels and memory primitives are keyed by plain `id`. Editor-specific
 * key prefixing (`ch:`, `mem:`) is workflow-builder's concern.
 */
export interface WorkflowState {
  canvases: Record<string, CanvasData>;
  channels?: Record<string, ChannelInstance>;
  memory?: Record<string, MemoryInstance>;
  /** Declared custom/self-hosted models (channel-like). Static catalog models need no declaration. */
  models?: Record<string, ModelInstance>;
}
