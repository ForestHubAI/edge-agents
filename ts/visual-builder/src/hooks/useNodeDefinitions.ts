import { useMemo, useCallback } from "react";
import i18n from "../i18n";
import { NodeCategory, DataType, NodeRegistry, NodeDefinition, NodeInstance } from "@foresthub/workflow-core/types/node";
import type { FunctionInfo } from "@foresthub/workflow-core/types/node";
import { useFunctionRegistry } from "./useFunctionRegistry";
import { FunctionCallNode, FunctionNodeDefinition } from "@foresthub/workflow-core/types/node/FunctionNode";
import { paramKey } from "../utils/variables";

// Use function registry to provide dynamic node definitions based on available functions
export const useNodeDefinitions = () => {
  // Get static node definitions from registry (these never change)
  const staticNodeDefs: NodeDefinition[] = NodeRegistry.getAll();

  // Subscribe to function registry (derived from all canvas stores)
  const { functions } = useFunctionRegistry();

  // Dynamically create node definitions for each function
  const functionNodeDefs: FunctionNodeDefinition[] = useMemo(
    () => Object.values(functions).map((fn) => buildFunctionNodeDef(fn)),
    [functions],
  );

  // Get node definition for a node instance (still depending on all functions)
  const getNodeDefinition = useCallback(
    (node: NodeInstance): NodeDefinition | undefined => {
      if (node.type === "FunctionCall") {
        const fnNode = node as FunctionCallNode;
        return functionNodeDefs.find((def) => def.type === "FunctionCall" && def.functionInfo.id === fnNode.functionInfo.id);
      }
      return NodeRegistry.getByType(node.type);
    },
    [functionNodeDefs],
  );

  const getNodeDefinitionsByCategory = useCallback(
    (category: NodeCategory) => {
      const staticNodes = NodeRegistry.getByCategory(category);
      if (category === NodeCategory.Function) {
        return [...staticNodes, ...functionNodeDefs];
      }
      return staticNodes;
    },
    [functionNodeDefs],
  );

  const getAllCategories = useCallback((): NodeCategory[] => {
    const staticCategories = NodeRegistry.getAllCategories();
    const allCategories = new Set([...staticCategories]);
    if (functionNodeDefs.length > 0) {
      allCategories.add(NodeCategory.Function);
    }
    const categoryOrder = [
      NodeCategory.Trigger,
      NodeCategory.Input,
      NodeCategory.Logic,
      NodeCategory.Data,
      NodeCategory.Function,
      NodeCategory.AI,
      NodeCategory.Tool,
      NodeCategory.Output,
    ];
    return categoryOrder.filter((cat) => allCategories.has(cat));
  }, [functionNodeDefs]);

  return {
    nodeDefinitions: [...staticNodeDefs, ...functionNodeDefs],
    getAllCategories,
    getNodeDefinition,
    getNodeDefinitionsByCategory,
  };
};

// Build a FunctionCall NodeDefinition from FunctionInfo.
// Inputs become expression parameters keyed by arg uid, returns become static
// outputs keyed by return uid. The rest of the system then handles FunctionCall
// like any other node — flat parameter reads, flat output binding writes.
export function buildFunctionNodeDef(fn: FunctionInfo): FunctionNodeDefinition {
  return {
    type: "FunctionCall",
    functionInfo: fn,
    label: fn.name,
    category: NodeCategory.Function,
    description: i18n.t("builder.functionCallDesc", { name: fn.name }),
    parameters: [
      ...fn.arguments.map((param) => ({
        id: paramKey(param),
        label: param.name,
        description: i18n.t("builder.functionParamDesc", { name: param.name }),
        type: "expression" as const,
        expressionType: param.dataType as DataType,
        activationRules: [{ type: "isControlFlow" as const }],
      })),
      {
        id: "toolDescription",
        label: "Tool Description",
        description: "Description shown to the agent when this function is wired as a tool",
        type: "string" as const,
        multiline: true,
        activationRules: [{ type: "isToolInput" as const }],
      },
    ],
    outputs: fn.returns.map((ret) => ({
      id: paramKey(ret),
      label: ret.name,
      type: "static" as const,
      dataType: ret.dataType as DataType,
    })),
  };
}
