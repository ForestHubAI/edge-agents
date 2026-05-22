import { NodeData, NodeRegistry } from "@foresthub/workflow-core/node";
import { NodeProps } from "@xyflow/react";
import { memo, useMemo } from "react";
import { BaseNode } from "./BaseNode";

// Standard node component for all non-FunctionCall nodes
// Simply resolves the node definition from the registry and delegates to BaseNode
export const CustomNode = memo((props: NodeProps) => {
  const nodeData = props.data as NodeData;

  // Get node definition from static registry
  const nodeDefinition = useMemo(() => {
    return NodeRegistry.getByType(nodeData.type);
  }, [nodeData.type]);
  return <BaseNode {...props} nodeDefinition={nodeDefinition} />;
});
