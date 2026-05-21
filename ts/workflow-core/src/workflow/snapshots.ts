import type { ChannelInstance } from "../channel";
import type { MemoryFileInstance } from "../memory";
import type { NodeInstance, FunctionInfo, Expression } from "../node";
import type { EdgeInstance } from "../edge";
import type { CanvasVariable } from "../variable";

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
 * In-memory domain workflow state — the shape the headless validator consumes.
 *
 * NOT a persistence format: this lives only in memory. Persisted JSON uses the
 * contract `Schemas["Workflow"]`; `serialize(state)`/`deserialize(workflow)` in
 * `./workflowSerialization` convert between the two. Two producers feed this
 * shape: the editor reads it from live Zustand stores; the CLI calls
 * `deserialize(contractWorkflow)` after parsing JSON.
 *
 * Channels and memory files are keyed by plain `id`/`uid`. Editor-specific
 * key prefixing (`ch:`, `mem:`) is workflow-builder's concern.
 */
export interface WorkflowState {
  canvases: Record<string, CanvasData>;
  channels?: Record<string, ChannelInstance>;
  memoryFiles?: Record<string, MemoryFileInstance>;
}
