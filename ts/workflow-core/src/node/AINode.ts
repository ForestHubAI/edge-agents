// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { NodeBase } from "./Node";
import type { Reference, Schemas } from "../api";
import { OutputBinding, OutputDeclaration } from "../parameter";
import { NodeCategory } from "./constants";
import { NodeDefinition } from "./NodeDefinition";

export type MemoryRef = Schemas["MemoryRef"];

export interface AgentNode extends NodeBase {
  type: "Agent";
  arguments: {
    name: string;
    model: string;
    instructions: string;
    maxTurns: number | undefined;
    outputDeclarations: OutputDeclaration[];
    memoryRefs: MemoryRef[];
    answer: OutputBinding;
    toolDescription?: string;
  };
}

// MLInference — runs a declared ML model on an input and returns its result.
// The model is selected from the workflow's declared MLModels; the input is a
// reference to a variable whose value is fed to the model, and the result is
// emitted as a string.
export interface MLInferenceNode extends NodeBase {
  type: "MLInference";
  arguments: {
    model: string;
    input: Reference | undefined;
    output: OutputBinding;
  };
}

export type AINodeType = "Agent" | "MLInference";
export type AINode = AgentNode | MLInferenceNode;

// Node Definitions

export const AgentNodeDefinition: NodeDefinition = {
  type: "Agent",
  label: "LLM Agent",
  category: NodeCategory.AI,
  description: "AI-powered agent for intelligent processing",
  canBranch: true, // Control output may fan out to multiple branches (tool output is always multi-target).
  outputs: [
    { id: "answer", label: "Answer", type: "static", dataType: "string" },
    { id: "outputDeclarations", label: "Structured Output", type: "list" },
  ],
  parameters: [
    {
      id: "name",
      label: "Name",
      description: "Name of the agent",
      optional: true,
      type: "string",
    },
    {
      id: "model",
      label: "Model",
      description: "AI model to use for the agent",
      type: "modelSelect",
      modelType: ["LLMModel"],
      capabilities: ["chat"],
    },
    {
      id: "instructions",
      label: "Instructions",
      description: "Instructions for the cloud agent that act as system prompt",
      type: "string",
      multiline: true,
      optional: true,
    },
    {
      id: "maxTurns",
      label: "Max Turns",
      description: "Maximum number of agent runner turns",
      type: "int",
      optional: true,
    },
    {
      id: "memoryRefs",
      label: "Memory Files",
      description: "Project memory files this agent can access, with per-file read or read+write mode",
      type: "memory-refs",
      default: [],
    },
    {
      id: "toolDescription",
      label: "Tool Description",
      description: "Description shown to the calling agent when this agent is wired as a tool",
      type: "string",
      multiline: true,
      activationRules: [{ type: "isToolInput" }],
    },
  ],
};

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
      description: "Variable whose value is fed to the model",
      type: "variableSelect",
    },
  ],
};
