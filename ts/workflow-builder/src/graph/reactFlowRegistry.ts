// ReactFlow node/edge type registries
// Maps ReactFlow type strings to the React components that render them.
// Shared between CanvasArea (editor) and VersionPreviewCanvas (read-only preview).
// Lives in graph/ because it references sibling components, but is only consumed
// by higher-level composing components — no graph/ component imports this file.

import { NodeCategory } from "@foresthub/workflow-core/node";
import { CustomNode } from "./CustomNode";
import { FunctionCallNode } from "./FunctionCallNode";
import CustomEdge from "./CustomEdge";

export const nodeTypes = {
  Standard: CustomNode,
  FunctionCall: FunctionCallNode,
  [NodeCategory.Trigger]: CustomNode,
  [NodeCategory.Tool]: CustomNode,
  [NodeCategory.AI]: CustomNode,
};

export const edgeTypes = {
  control: CustomEdge,
  tool: CustomEdge,
  agentTask: CustomEdge,
  agentChoice: CustomEdge,
  agentDelegate: CustomEdge,
};
