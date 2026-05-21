import type { Expression } from "../node";

export interface EdgeInstance extends Record<string, unknown> {
  prompt?: Expression; // agentTask and agentDelegate
  description?: string; // agentChoice and agentDelegate
}

/**
 * Minimal structural shape of a graph edge — only the connectivity fields.
 * Deliberately NOT React Flow's `Edge`: lets the editor
 * pass its own `Edge[]` without an adapter while core stays free of
 * `@xyflow/react` (same approach as `computeAvailableVariables`' edge param).
 * The `data` payload is intentionally omitted — pure paths never inspect it.
 */
export interface GraphEdge {
  id?: string;
  type?: string | null;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}
