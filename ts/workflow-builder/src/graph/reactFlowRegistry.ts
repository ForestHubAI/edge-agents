// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// ReactFlow node/edge type registries
// Maps ReactFlow type strings to the React components that render them.
// Lives in graph/ because it references sibling components, but is only consumed
// by higher-level composing components — no graph/ component imports this file.

import { NodeCategory } from "@foresthubai/workflow-core/node";
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
