import type { Expression } from "../api";

export interface EdgeData extends Record<string, unknown> {
  prompt?: Expression; // agentTask and agentDelegate
  description?: string; // agentChoice and agentDelegate
}

/**
 * Full domain edge entity held on a {@link Canvas}: connectivity topology plus
 * the optional {@link EdgeData} payload. Low-level core fns that read only
 * connectivity accept it directly, and the editor's React Flow `Edge[]` is
 * structurally assignable
 * without an adapter (core stays free of `@xyflow/react`).
 */
export interface Edge {
  id: string;
  type?: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
  data?: EdgeData;
}
