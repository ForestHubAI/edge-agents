import { Expression, NodeBase } from "./Node";
import { OutputBinding } from "../parameter";
import { NodeCategory, NodeTag } from "./constants";
import { NodeDefinition } from "./NodeDefinition";

// MQTT Publish - publishes a single value to an MQTT topic
export interface MqttPublishNode extends NodeBase {
  type: "MqttPublish";
  arguments: {
    channelReference: string;
    topic: string;
    dataType: "int" | "float" | "bool" | "string";
    value: Expression;
    qos: 0 | 1 | 2;
    retain: boolean;
  };
}

// On MQTT Message - fires when a message is received on a subscribed topic
export interface OnMqttMessageNode extends NodeBase {
  type: "OnMqttMessage";
  arguments: {
    channelReference: string;
    topic: string;
    dataType: "int" | "float" | "bool" | "string";
    output: OutputBinding;
  };
}

export type MqttNodeType = "MqttPublish" | "OnMqttMessage";
export type MqttNode = MqttPublishNode | OnMqttMessageNode;

// Node Definitions

export const MqttPublishNodeDefinition: NodeDefinition = {
  type: "MqttPublish",
  label: "MQTT Publish",
  category: NodeCategory.Output,
  tags: [NodeTag.Network],
  description: "Publish a value to an MQTT topic",
  parameters: [
    {
      id: "channelReference",
      label: "Channel",
      description: "MQTT channel to publish through",
      type: "channelSelect",
      channelType: ["MQTT"],
    },
    {
      id: "topic",
      label: "Topic",
      description: "MQTT topic path (e.g. sensors/temperature)",
      type: "string",
    },
    {
      id: "dataType",
      label: "Data Type",
      description: "Data type of the value to publish",
      type: "selection",
      options: [
        { value: "int", label: "Integer" },
        { value: "float", label: "Float" },
        { value: "bool", label: "Boolean" },
        { value: "string", label: "String" },
      ],
      default: "string",
    },
    {
      id: "value",
      label: "Value",
      description: "Value to publish",
      type: "expression",
      expressionType: (args) => (args as MqttPublishNode["arguments"]).dataType,
    },
    {
      id: "qos",
      label: "QoS",
      description: "Quality of Service level",
      type: "selection",
      options: [
        { value: "0", label: "0 - At most once" },
        { value: "1", label: "1 - At least once" },
        { value: "2", label: "2 - Exactly once" },
      ],
      default: "0",
    },
    {
      id: "retain",
      label: "Retain",
      description: "Whether the broker should retain the message",
      type: "bool",
      default: false,
    },
  ],
};

export const OnMqttMessageNodeDefinition: NodeDefinition = {
  type: "OnMqttMessage",
  label: "On MQTT Message",
  category: NodeCategory.Trigger,
  tags: [NodeTag.Network],
  description: "Fires when a message is received on a subscribed MQTT topic",
  outputs: [
    {
      id: "output",
      label: "Message Value",
      type: "static",
      dataType: (args) => (args as OnMqttMessageNode["arguments"]).dataType,
    },
  ],
  parameters: [
    {
      id: "channelReference",
      label: "Channel",
      description: "MQTT channel to subscribe through",
      type: "channelSelect",
      channelType: ["MQTT"],
    },
    {
      id: "topic",
      label: "Topic",
      description: "MQTT topic path pattern to subscribe to (e.g. sensors/temperature)",
      type: "string",
    },
    {
      id: "dataType",
      label: "Data Type",
      description: "Expected data type of the received message value",
      type: "selection",
      options: [
        { value: "int", label: "Integer" },
        { value: "float", label: "Float" },
        { value: "bool", label: "Boolean" },
        { value: "string", label: "String" },
      ],
      default: "string",
    },
  ],
};
