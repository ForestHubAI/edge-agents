import { NodeBase } from "./Node";
import type { Expression } from "../api";
import { OutputBinding } from "../parameter";
import { NodeCategory } from "./constants";
import { NodeDefinition } from "./NodeDefinition";

// MLInference — runs a declared ML model on an input and returns its result.
// The model is selected from the workflow's declared MLModels; the input
// expression is fed to it and the result is emitted as a string.
export interface MLInferenceNode extends NodeBase {
  type: "MLInference";
  arguments: {
    model: string;
    input: Expression;
    output: OutputBinding;
  };
}

export type MLInferenceNodeType = "MLInference";

export const MLInferenceNodeDefinition: NodeDefinition = {
  type: "MLInference",
  label: "ML Inference",
  category: NodeCategory.AI,
  description: "Runs a machine-learning model on an input and returns its result",
  outputs: [{ id: "output", label: "Result", type: "static", dataType: "string" }],
  parameters: [
    {
      id: "model",
      label: "Model",
      description: "ML model to run",
      type: "modelSelect",
      modelType: ["MLModel"],
    },
    {
      id: "input",
      label: "Input",
      description: "Input expression fed to the model",
      type: "expression",
      expressionType: "string",
      default: { expression: "", references: [], dataType: "string" },
    },
  ],
};
