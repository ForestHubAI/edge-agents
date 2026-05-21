import { NodeBase, Expression } from "./Node";
import { NodeCategory } from "./constants";
import { NodeDefinition } from "./NodeDefinition";

export interface IfNode extends NodeBase {
  type: "If";
  arguments: {
    condition: Expression;
  };
}

export type LogicNodeType = "If";
export type LogicNode = IfNode;

// Node Definitions

export const IfNodeDefinition: NodeDefinition = {
  type: "If",
  label: "If Condition Node",
  category: NodeCategory.Logic,
  description: "Conditional branching based on boolean expression",
  parameters: [
    {
      id: "condition",
      label: "Condition",
      description: "Boolean expression (e.g., ${Input_1.value} > 50)",
      type: "expression",
      expressionType: "bool",
      default: { expression: "", references: [], dataType: "bool" },
    },
  ],
};
