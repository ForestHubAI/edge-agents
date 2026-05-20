import type { Schemas } from "../api";
import { InputNode, InputNodeType } from "./InputNode";
import { OutputNode, OutputNodeType } from "./OutputNode";
import { AgentNode, AgentNodeType } from "./AgentNode";
import { LogicNode, LogicNodeType } from "./LogicNode";
import { DataNode, DataNodeType } from "./DataNode";
import { TriggerNode, TriggerNodeType } from "./TriggerNode";
import { ToolNode, ToolNodeType } from "./ToolNode";
import { FunctionCallNode, FunctionCallNodeType } from "./FunctionNode";
import { MqttNode, MqttNodeType } from "./MqttNode";

// Re-export
export { NodeCategory, NodeTag } from "./NodeConstants";
export { NodeRegistry } from "./NodeRegistry";
export type { NodeDefinition, Port, PortDefinitions } from "./NodeDefinition";
export type { OutputParameter, StaticOutput, OutputList, OutputBinding, OutputDeclaration } from "../parameter";

// NodeMethods — read helpers over a NodeInstance
export {
  getPorts,
  getArguments,
  getNodeOutput,
  getNodeAvailableOutput,
  getOutputBinding,
  getInput,
} from "./NodeMethods";
export type { ExternalInput } from "./NodeMethods";

// FunctionCall — special node whose definition is built from FunctionInfo
export type { FunctionCallNode, FunctionCallNodeType, FunctionNodeDefinition } from "./FunctionNode";
export { buildFunctionNodeDef } from "./FunctionNode";

// Port-level helpers used by the visual builder and by validation.
export { isNodeUsedAsTool, canPortAcceptEdge, getCompatibleNodeDefs, isValidConnection } from "./portUtils";

// =============================================================================
// TYPE DEFINITIONS (from API schema)
// =============================================================================
export type DataType = Schemas["DataType"];
export type Variable = Schemas["Variable"];
export type Reference = Schemas["Reference"];
export type Expression = Schemas["Expression"];
export type FunctionInfo = Schemas["FunctionInfo"];

export type NodeOutput = { name: string; dataType: DataType };
export type NodeType =
  | InputNodeType
  | OutputNodeType
  | AgentNodeType
  | LogicNodeType
  | DataNodeType
  | TriggerNodeType
  | ToolNodeType
  | FunctionCallNodeType
  | MqttNodeType;

/**
 * NodeInstance represents the runtime data for a node in the visual builder.
 * It is a union type of all specific node types, each with their own typed parameters.
 * Use this type when you need strong typing for a specific node.
 */
export type NodeInstance = InputNode | OutputNode | AgentNode | LogicNode | DataNode | TriggerNode | ToolNode | FunctionCallNode | MqttNode;

/**
 * NodeBase is a generic interface for all node instances.
 * It uses an untyped parameters record to allow generic parameter handling (e.g., in React Flow nodes).
 * Narrow to NodeInstance for specific node operations that require typed parameters.
 *
 * Per-output bindings (emit/assign/discard) live as flat entries inside `arguments`,
 * keyed by the output id — same namespace as parameter values. List output entries
 * (e.g. AgentNode's `outputDefinitions`) bundle their binding alongside their variable
 * declaration as OutputDeclaration[].
 */
export interface NodeBase extends Record<string, unknown> {
  id: string; // Same as the React Flow node ID
  type: NodeType; // Node discriminator
  label?: string; // User-editable display label (falls back to nodeDefinition.label)
}
