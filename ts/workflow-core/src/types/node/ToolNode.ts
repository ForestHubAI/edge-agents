import { NodeBase } from ".";
import { NodeCategory } from "./NodeConstants";
import { NodeDefinition } from "./NodeDefinition";

// Web Search Tool - provides web search capability to agents
export interface WebSearchToolNode extends NodeBase {
  type: "WebSearchTool";
  arguments: {
    maxResults?: number;
  };
}

export type ToolNodeType = "WebSearchTool";
export type ToolNode = WebSearchToolNode;

// Node Definitions

export const WebSearchToolNodeDefinition: NodeDefinition = {
  type: "WebSearchTool",
  label: "Web Search",
  category: NodeCategory.Tool,
  description: "Provides web search capability to connected agents",
  parameters: [
    {
      id: "maxResults",
      label: "Max Results",
      description: "Maximum number of search results to return per call (capped at 20)",
      type: "int",
      optional: true,
    },
  ],
};
