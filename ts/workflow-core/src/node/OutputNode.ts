import { NodeBase, Expression } from "./Node";
import { NodeCategory, NodeTag } from "./constants";
import { NodeDefinition } from "./NodeDefinition";

export interface WritePinNode extends NodeBase {
  type: "WritePin";
  arguments: {
    pinReference: string | undefined;
    signalType: "digital" | "analog";
    value: Expression;
  };
}

export interface SerialWriteNode extends NodeBase {
  type: "SerialWrite";
  arguments: {
    portReference: string | undefined;
    value: Expression; // Expression for the value to write
  };
}

export type OutputNodeType = "WritePin" | "SerialWrite";
export type OutputNode = WritePinNode | SerialWriteNode;

// Node Definitions

export const WritePinNodeDefinition: NodeDefinition = {
  type: "WritePin",
  label: "Write Pin",
  category: NodeCategory.Output,
  tags: [NodeTag.Pin],
  description: "Write data to a pin",
  parameters: [
    {
      id: "pinReference",
      label: "Pin",
      description: "IO pin to write to",
      type: "channelSelect",
      channelType: (args) => ((args as WritePinNode["arguments"]).signalType === "digital" ? ["GPIOOUT"] : ["PWM", "DAC"]),
    },
    {
      id: "signalType",
      label: "Signal Type",
      description: "Type of signal",
      type: "selection",
      default: "digital",
      options: [
        { value: "digital", label: "Digital" },
        { value: "analog", label: "Analog" },
      ],
    },
    {
      id: "value",
      label: "Value",
      description: "What value to write to the pin",
      type: "expression",
      expressionType: (args) => ((args as WritePinNode["arguments"]).signalType === "digital" ? "bool" : "int"),
      default: { expression: "", references: [], dataType: "bool" },
    },
  ],
};

export const SerialWriteNodeDefinition: NodeDefinition = {
  type: "SerialWrite",
  label: "Serial Write",
  category: NodeCategory.Output,
  tags: [NodeTag.Serial],
  description: "Write string to serial port",
  parameters: [
    {
      id: "portReference",
      label: "Port",
      description: "Serial port to write to",
      type: "channelSelect",
      channelType: ["UART"],
    },
    {
      id: "value",
      label: "Value",
      description: "Expression for the value to write",
      type: "expression",
      expressionType: "string",
      default: { expression: "", references: [], dataType: "string" },
    },
  ],
};
