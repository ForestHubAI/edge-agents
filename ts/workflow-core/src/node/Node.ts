// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// Domain Node — the base shape every node variant builds on. NodeBase is the
// generic, untyped-parameters shape used wherever a node is handled generically
// (e.g. React Flow nodes); NodeData is the discriminated union over the
// per-variant interfaces (InputNode, AgentNode, …) for strongly-typed work.
// Mirrors how channel/memory/model keep their base shape in a same-named file and
// leave index.ts as a pure barrel. The per-variant interfaces import NodeBase
// from here directly, not via the barrel.

import type { DataType } from "../api";
import { InputNode, InputNodeType } from "./InputNode";
import { OutputNode, OutputNodeType } from "./OutputNode";
import { AINode, AINodeType } from "./AINode";
import { LogicNode, LogicNodeType } from "./LogicNode";
import { DataNode, DataNodeType } from "./DataNode";
import { TriggerNode, TriggerNodeType } from "./TriggerNode";
import { ToolNode, ToolNodeType } from "./ToolNode";
import { FunctionCallNode, FunctionCallNodeType } from "./FunctionNode";
import { MqttNode, MqttNodeType } from "./MqttNode";

export type NodeOutput = { name: string; dataType: DataType };
export type NodeType =
  | InputNodeType
  | OutputNodeType
  | AINodeType
  | LogicNodeType
  | DataNodeType
  | TriggerNodeType
  | ToolNodeType
  | FunctionCallNodeType
  | MqttNodeType;

/**
 * NodeData represents the runtime data for a node in the workflow builder.
 * It is a union type of all specific node types, each with their own typed parameters.
 * Use this type when you need strong typing for a specific node.
 */
export type NodeData = InputNode | OutputNode | AINode | LogicNode | DataNode | TriggerNode | ToolNode | FunctionCallNode | MqttNode;

/**
 * Full domain node entity held on a {@link Canvas}: the {@link NodeData}
 * payload plus its canvas layout position, flattened. id/type/arguments/label
 * come from NodeData; only `position` is added. The editor projects this into
 * a React Flow node (adding the display type) at its store boundary.
 */
export type Node = NodeData & { position: { x: number; y: number } };

/**
 * NodeBase is a generic interface for all node instances.
 * It uses an untyped parameters record to allow generic parameter handling (e.g., in React Flow nodes).
 * Narrow to NodeData for specific node operations that require typed parameters.
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
