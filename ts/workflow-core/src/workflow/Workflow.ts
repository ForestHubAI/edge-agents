import type { ChannelInstance } from "../channel";
import type { MemoryInstance } from "../memory";
import type { ModelInstance } from "../model";
import type { NodeInstance, FunctionInfo, Expression } from "../node";
import type { EdgeInstance } from "../edge";
import type { Variable } from "../variable";
import type { Schemas } from "../api";

export type ApiWorkflow = Schemas["Workflow"];

/**
 * The id of the project's main canvas. All other canvas ids identify function
 * definitions. Lives here next to {@link Workflow} (which keys canvases
 * by this value) so the headless validator can reason about canvas scope
 * without depending on a UI store.
 */
export const MAIN_CANVAS_ID = "main" as const;

/**
 * In-memory domain workflow state — the shape the headless validator consumes.
 *
 * NOT a persistence format: this lives only in memory. Persisted JSON uses the
 * contract `Schemas["Workflow"]`; `serialize(state)`/`deserialize(workflow)` in
 * `./serialization` convert between the two. Two producers feed this
 * shape: the editor reads it from live Zustand stores; the CLI calls
 * `deserialize(contractWorkflow)` after parsing JSON.
 */
export interface Workflow {
  canvases: Record<string, Canvas>;
  channels?: Record<string, ChannelInstance>;
  memory?: Record<string, MemoryInstance>;
  models?: Record<string, ModelInstance>;
}

/**
 * One canvas's worth of in-memory domain state.
 */
export interface Canvas {
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
  variables: Record<string, Variable>;
  functionInfo: FunctionInfo | null;
  outputAssignments: Record<string, Expression>;
}
