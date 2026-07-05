// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { useMemo, useCallback } from "react";
import i18n from "../i18n";
import { NodeCategory, NodeRegistry, NodeDefinition, NodeData } from "@foresthubai/workflow-core/node";
import { useFunctionRegistry } from "./useFunctionRegistry";
import { toFunctionInfo, type FunctionInfo } from "@foresthubai/workflow-core/function";
import { FunctionCallNode, FunctionNodeDefinition, buildFunctionNodeDef as coreBuildFunctionNodeDef } from "@foresthubai/workflow-core/node";

/**
 * Workflow-builder binding for {@link coreBuildFunctionNodeDef} — passes
 * `i18n.t` so descriptions are translated. Consumers continue to call
 * `buildFunctionNodeDef(fn)` unchanged; core's signature is the pure
 * `(fn, t?)` form.
 */
export function buildFunctionNodeDef(fn: FunctionInfo): FunctionNodeDefinition {
  return coreBuildFunctionNodeDef(fn, i18n.t.bind(i18n));
}

// Use function registry to provide dynamic node definitions based on available functions
export const useNodeDefinitions = () => {
  // Get static node definitions from registry (these never change)
  const staticNodeDefs: NodeDefinition[] = NodeRegistry.getAll();

  // Subscribe to function registry (derived from all canvas stores)
  const { functions } = useFunctionRegistry();

  // Dynamically create node definitions for each function. The call-site node def is
  // built from the flat signature snapshot, so project the domain declaration here.
  const functionNodeDefs: FunctionNodeDefinition[] = useMemo(
    () => Object.values(functions).map((fn) => buildFunctionNodeDef(toFunctionInfo(fn))),
    [functions],
  );

  // Get node definition for a node instance (still depending on all functions)
  const getNodeDefinition = useCallback(
    (node: NodeData): NodeDefinition | undefined => {
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

