import type { Expression } from "../node";

export { type EdgeDefinition, getEdgeDefinition, EDGE_DEFINITIONS } from "./EdgeDefinition";
export { type EdgeType, type ControlFlowType, type ToolFlowType, isControlFlow, isToolFlow } from "./EdgeType";

export interface EdgeInstance extends Record<string, unknown> {
  prompt?: Expression; // agentTask and agentDelegate
  description?: string; // agentChoice and agentDelegate
}
