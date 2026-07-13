// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { ReadPinNodeDefinition, SerialReadNodeDefinition, RetrieverNodeDefinition, WebFetchNodeDefinition, CameraCaptureNodeDefinition } from "./InputNode";
import { AgentNodeDefinition, MLInferenceNodeDefinition } from "./AINode";
import {
  DelayNodeDefinition,
  TickerNodeDefinition,
  AlarmNodeDefinition,
  OnFunctionCallNodeDefinition,
  OnStartupNodeDefinition,
  OnPinEdgeNodeDefinition,
  OnSerialReceiveNodeDefinition,
  OnThresholdNodeDefinition,
} from "./TriggerNode";
import { WebSearchToolNodeDefinition } from "./ToolNode";
import { NodeType } from "./Node";
import { NodeCategory } from "./constants";
import { SerialWriteNodeDefinition, WritePinNodeDefinition } from "./OutputNode";
import { IfNodeDefinition } from "./LogicNode";
import { SetVariableNodeDefinition } from "./DataNode";
import { MqttPublishNodeDefinition, OnMqttMessageNodeDefinition } from "./MqttNode";
import { NodeDefinition } from "./NodeDefinition";

/**
 * Central registry for all node definitions.
 */
class NodeDefinitionRegistry {
  private nodes: Map<NodeType, NodeDefinition> = new Map();
  private initialized = false;

  initialize() {
    if (this.initialized) return;

    // Register all nodes
    this.register(ReadPinNodeDefinition);
    this.register(SerialReadNodeDefinition);
    this.register(WritePinNodeDefinition);
    this.register(SerialWriteNodeDefinition);
    this.register(AgentNodeDefinition);
    this.register(MLInferenceNodeDefinition);
    this.register(IfNodeDefinition);
    this.register(SetVariableNodeDefinition);
    // Register trigger nodes
    this.register(OnFunctionCallNodeDefinition);
    this.register(DelayNodeDefinition);
    this.register(TickerNodeDefinition);
    this.register(AlarmNodeDefinition);
    this.register(OnStartupNodeDefinition);
    this.register(OnPinEdgeNodeDefinition);
    this.register(OnSerialReceiveNodeDefinition);
    this.register(OnThresholdNodeDefinition);
    // Register tool nodes
    this.register(WebSearchToolNodeDefinition);
    // Register input tool nodes
    this.register(RetrieverNodeDefinition);
    this.register(WebFetchNodeDefinition);
    this.register(CameraCaptureNodeDefinition);
    // Register MQTT nodes
    this.register(MqttPublishNodeDefinition);
    this.register(OnMqttMessageNodeDefinition);

    this.initialized = true;
  }

  private register(definition: NodeDefinition) {
    this.nodes.set(definition.type, definition);
  }

  getAll(): NodeDefinition[] {
    return Array.from(this.nodes.values());
  }

  getAllCategories(): NodeCategory[] {
    const categories = new Set(this.getAll().map((node) => node.category));
    return Array.from(categories).sort();
  }

  getByType(type: NodeType): NodeDefinition | undefined {
    return this.nodes.get(type);
  }

  getByCategory(category: NodeCategory): NodeDefinition[] {
    return this.getAll().filter((node) => node.category === category);
  }
}

// Create and initialize the registry
export const NodeRegistry = new NodeDefinitionRegistry();
NodeRegistry.initialize();
