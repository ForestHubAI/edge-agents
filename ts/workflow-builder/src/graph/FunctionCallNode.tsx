// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { FunctionCallNode as DomainFunctionCallNode } from "@foresthubai/workflow-core/node";
import { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";
import { buildFunctionNodeDef } from "../hooks/useNodeDefinitions";
import { useFunctionRegistry } from "../hooks/useFunctionRegistry";
import { BaseNode } from "./BaseNode";

// Specialized node component for FunctionCall nodes
// Renders from node's stored data (usually up-to-date via auto-migration,
// but may be stale after undo)
export const FunctionCallNode = memo((props: NodeProps) => {
  const nodeData = props.data as DomainFunctionCallNode;

  // Get function info for staleness check and live label
  const { getFunction } = useFunctionRegistry();
  const registryFunctionInfo = getFunction(nodeData.functionInfo.id);

  const isDeleted = !registryFunctionInfo;
  const isStale = registryFunctionInfo
    ? nodeData.functionInfo.version !== registryFunctionInfo.version
    : false;

  // Build node definition from node's stored functionInfo, using registry name for label
  const nodeDefinition = useMemo(() => {
    const name = registryFunctionInfo?.name ?? nodeData.functionInfo.name;
    return buildFunctionNodeDef({ ...nodeData.functionInfo, name });
  }, [nodeData.functionInfo, registryFunctionInfo?.name]);

  return <BaseNode {...props} nodeDefinition={nodeDefinition} isStale={isStale} isDeleted={isDeleted} />;
});
