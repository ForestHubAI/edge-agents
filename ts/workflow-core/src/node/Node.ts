// Domain Node — the base contract every node variant builds on. NodeBase is the
// generic, untyped-parameters shape used wherever a node is handled generically
// (e.g. React Flow nodes); NodeInstance is the discriminated union over the
// per-variant interfaces (InputNode, AgentNode, …) for strongly-typed work.
// Mirrors how channel/memory/model keep their contract in a same-named file and
// leave index.ts as a pure barrel. The per-variant interfaces import NodeBase
// from here directly, not via the barrel.

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

// =============================================================================
// TYPE DEFINITIONS (from API schema)
// =============================================================================
export type ApiVariable = Schemas["Variable"]; // Differentiate from domain variable type
export type DataType = Schemas["DataType"];
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
 * NodeInstance represents the runtime data for a node in the workflow builder.
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
 * (e.g. AgentNode's `outputDeclarations`) bundle their binding alongside their variable
 * declaration as OutputDeclaration[].
 */
export interface NodeBase extends Record<string, unknown> {
  id: string; // Same as the React Flow node ID
  type: NodeType; // Node discriminator
  label?: string; // User-editable display label (falls back to nodeDefinition.label)
}
