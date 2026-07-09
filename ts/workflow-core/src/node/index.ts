// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// Base domain node types
export type {
  NodeOutput,
  NodeType,
  NodeData,
  Node,
  NodeBase,
} from "./Node";

// Constants & registry
export { NodeCategory, NodeTag } from "./constants";
export { NodeRegistry } from "./NodeRegistry";
export type { NodeDefinition, Port, PortDefinitions } from "./NodeDefinition";
export type { OutputParameter, StaticOutput, OutputList, OutputBinding, OutputDeclaration } from "../parameter";

// NodeMethods — read helpers over a NodeData
export { getPorts, getArguments, getNodeOutput, getNodeAvailableOutput, getOutputBinding, getInput, isNodeUsedAsTool } from "./methods";
export type { ExternalInput } from "./methods";

// FunctionCall — special node whose definition is built from FunctionInfo
export type { FunctionCallNode, FunctionCallNodeType, FunctionNodeDefinition } from "./FunctionNode";
export { buildFunctionNodeDef } from "./FunctionNode";

// Serialization — domain Node <-> api
export { serialize, deserialize } from "./serialization";
export type { ApiNode } from "./serialization";
