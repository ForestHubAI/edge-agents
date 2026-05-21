import type { Expression } from "../node";

export interface EdgeInstance extends Record<string, unknown> {
  prompt?: Expression; // agentTask and agentDelegate
  description?: string; // agentChoice and agentDelegate
}
