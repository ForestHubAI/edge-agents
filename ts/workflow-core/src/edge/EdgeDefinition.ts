import { Parameter } from "../parameter";
import type { EdgeType } from "./EdgeType";

export interface EdgeDefinition {
  label: string;
  description: string;
  parameters: Parameter[];
}

export const EDGE_DEFINITIONS: Record<EdgeType, EdgeDefinition> = {
  agentTask: {
    label: "Task",
    description: "Assigns a task to an agent with a prompt",
    parameters: [{ id: "prompt", label: "Prompt", description: "", type: "expression", expressionType: "string", default: { expression: "", references: [], dataType: "string" } }],
  },
  agentChoice: {
    label: "Choice",
    description: "A path the agent can choose based on its description",
    parameters: [
      { id: "description", label: "Description", description: "", type: "string", default: "When should the agent take this path?" },
    ],
  },
  agentDelegate: {
    label: "Delegation",
    description: "Lets an agent hand off control to another agent",
    parameters: [
      { id: "description", label: "Description", description: "", type: "string", default: "When should the agent take this path?" },
      { id: "prompt", label: "Prompt", description: "", type: "expression", expressionType: "string", default: { expression: "", references: [], dataType: "string" } },
    ],
  },
  control: {
    label: "Control",
    description: "Sequential control flow between nodes",
    parameters: [],
  },
  tool: {
    label: "Tool",
    description: "Tool connection between nodes",
    parameters: [],
  },
};

export function getEdgeDefinition(type: EdgeType): EdgeDefinition {
  return EDGE_DEFINITIONS[type];
}
