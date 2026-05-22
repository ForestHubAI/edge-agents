// Base domain node types
export type {
  ApiVariable,
  DataType,
  Reference,
  Expression,
  FunctionInfo,
  NodeOutput,
  NodeType,
  NodeInstance,
  NodeBase,
} from "./Node";

// Constants & registry
export { NodeCategory, NodeTag } from "./constants";
export { NodeRegistry } from "./NodeRegistry";
export type { NodeDefinition, Port, PortDefinitions } from "./NodeDefinition";
export type { OutputParameter, StaticOutput, OutputList, OutputBinding, OutputDeclaration } from "../parameter";

// NodeMethods — read helpers over a NodeInstance
export { getPorts, getArguments, getNodeOutput, getNodeAvailableOutput, getOutputBinding, getInput, isNodeUsedAsTool } from "./methods";
export type { ExternalInput } from "./methods";

// FunctionCall — special node whose definition is built from FunctionInfo
export type { FunctionCallNode, FunctionCallNodeType, FunctionNodeDefinition } from "./FunctionNode";
export { buildFunctionNodeDef } from "./FunctionNode";
