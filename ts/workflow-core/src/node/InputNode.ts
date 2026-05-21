import { Expression, NodeBase, OutputBinding } from ".";
import { NodeCategory, NodeTag } from "./NodeConstants";
import { NodeDefinition } from "./NodeDefinition";

export interface ReadPinNode extends NodeBase {
  type: "ReadPin";
  arguments: {
    pinReference: string | undefined;
    signalType: "digital" | "analog";
    output: OutputBinding;
    toolDescription?: string;
  };
}

export interface SerialReadNode extends NodeBase {
  type: "SerialRead";
  arguments: {
    portReference: string | undefined;
    prompt?: string;
    output: OutputBinding;
  };
}

// Retriever - provides RAG retrieval capability to agents
export interface RetrieverNode extends NodeBase {
  type: "Retriever";
  arguments: {
    memoryReference: string;
    topK: number | undefined;
    query: Expression;
    output: OutputBinding;
    toolDescription?: string;
  };
}

// WebFetch - fetches a URL and returns extracted text
export interface WebFetchNode extends NodeBase {
  type: "WebFetch";
  arguments: {
    url: Expression;
    maxChars: number | undefined;
    output: OutputBinding;
  };
}

export type InputNodeType = "ReadPin" | "SerialRead" | "Retriever" | "WebFetch";
export type InputNode = ReadPinNode | SerialReadNode | RetrieverNode | WebFetchNode;

// Node Definitions

export const ReadPinNodeDefinition: NodeDefinition = {
  type: "ReadPin",
  label: "Read Pin",
  category: NodeCategory.Input,
  tags: [NodeTag.Pin],
  description: "Read data from a pin",
  outputs: [
    {
      id: "output",
      label: "Pin Value",
      type: "static",
      dataType: (args) => ((args as ReadPinNode["arguments"]).signalType === "digital" ? "bool" : "int"),
    },
  ],
  parameters: [
    {
      id: "pinReference",
      label: "Pin",
      description: "IO pin to read from",
      type: "channelSelect",
      channelType: (args) => ((args as ReadPinNode["arguments"]).signalType === "digital" ? ["GPIOIN"] : ["ADC"]),
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
      id: "toolDescription",
      label: "Tool Description",
      description: "Description shown to the agent when this node is wired as a tool",
      type: "string",
      multiline: true,
      activationRules: [{ type: "isToolInput" }],
    },
  ],
};

export const RetrieverNodeDefinition: NodeDefinition = {
  type: "Retriever",
  label: "Retriever",
  category: NodeCategory.Input,
  description: "Retrieves relevant documents from a knowledge base",
  outputs: [{ id: "output", label: "Retrieved Documents", type: "static", dataType: "string" }],
  parameters: [
    {
      id: "memoryReference",
      label: "Vector Database",
      description: "The vector database to search",
      type: "memorySelect",
      memoryType: ["VectorDatabase"],
    },
    {
      id: "topK",
      label: "Top K",
      description: "Number of results to retrieve",
      type: "int",
      default: 5,
    },
    {
      id: "query",
      label: "Query",
      description: "Search query expression",
      type: "expression",
      expressionType: "string",
    },
    {
      id: "toolDescription",
      label: "Tool Description",
      description: "Description shown to the agent when this node is wired as a tool",
      type: "string",
      multiline: true,
      activationRules: [{ type: "isToolInput" }],
    },
  ],
};

export const WebFetchNodeDefinition: NodeDefinition = {
  type: "WebFetch",
  label: "Web Fetch",
  category: NodeCategory.Input,
  description: "Fetches a URL and returns extracted text",
  outputs: [{ id: "output", label: "Fetched Text", type: "static", dataType: "string" }],
  parameters: [
    {
      id: "url",
      label: "URL",
      description: "URL to fetch (http or https)",
      type: "expression",
      expressionType: "string",
    },
    {
      id: "maxChars",
      label: "Max Characters",
      description: "Maximum characters of extracted text to return",
      type: "int",
      optional: true,
    },
  ],
};

export const SerialReadNodeDefinition: NodeDefinition = {
  type: "SerialRead",
  label: "Serial Read",
  category: NodeCategory.Input,
  tags: [NodeTag.Serial],
  description: "Read string from serial port",
  outputs: [{ id: "output", label: "Serial Data", type: "static", dataType: "string" }],
  parameters: [
    {
      id: "portReference",
      label: "Port",
      description: "Serial port to read from",
      type: "channelSelect",
      channelType: ["UART"],
    },
    {
      id: "prompt",
      label: "Input prompt",
      description: "Prompt for the serial read operation",
      type: "string",
      optional: true,
    },
  ],
};
