// Public surface of the edge module. The base type (EdgeData) lives in
// ./Edge; this file is a barrel only. Mirrors channel/memory/model.

export type { EdgeData, Edge } from "./Edge";
export { type EdgeDefinition, getEdgeDefinition, EDGE_DEFINITIONS } from "./EdgeDefinition";
export { type EdgeType, type ControlFlowType, type ToolFlowType, isControlFlow, isToolFlow } from "./EdgeType";
