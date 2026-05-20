// Edge taxonomy: a plain control/tool edge, or one of the three agent-specific
// control-flow refinements resolved at connection time from source/target context.
// Node port handles themselves only carry `control` or `tool`. Tool edges have no
// agent-specific variant — every tool edge points at an agent by construction.
export type EdgeType = "control" | "tool" | "agentTask" | "agentChoice" | "agentDelegate";

// All types that behave like control flow (horizontal bezier, side ports)
export type ControlFlowType = "control" | "agentTask" | "agentChoice" | "agentDelegate";

// All types that behave like tool connections (vertical bezier, top/bottom ports)
export type ToolFlowType = "tool";

export function isControlFlow(type: EdgeType): type is ControlFlowType {
  return type === "control" || type === "agentTask" || type === "agentChoice" || type === "agentDelegate";
}

export function isToolFlow(type: EdgeType): type is ToolFlowType {
  return type === "tool";
}
