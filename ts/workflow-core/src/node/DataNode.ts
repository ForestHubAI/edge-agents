import { NodeBase, Expression, Reference } from "./Node";
import { NodeCategory } from "./constants";
import { NodeDefinition } from "./NodeDefinition";

export interface SetVariableNode extends NodeBase {
  type: "SetVariable";
  arguments: {
    variable: Reference | undefined;
    value: Expression;
  };
}

export type DataNodeType = "SetVariable";
export type DataNode = SetVariableNode;

// Node Definitions

export const SetVariableNodeDefinition: NodeDefinition = {
  type: "SetVariable",
  label: "Set Variable",
  category: NodeCategory.Data,
  description: "Assign a new value to an existing variable",
  parameters: [
    {
      id: "variable",
      label: "Variable",
      description: "The variable to update",
      type: "variable-reference",
    },
    {
      id: "value",
      label: "Value",
      description: "Expression to assign",
      type: "expression",
      expressionType: "int", // fallback; actual type is derived from the target variable (see fromReference)
      fromReference: "variable",
    },
  ],
};
