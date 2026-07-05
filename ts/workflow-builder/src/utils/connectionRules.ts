// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Editor connection rules — which ports may connect, which node types are
// offered from a port, and whether a node can take another outgoing edge.
//
// These operate on React Flow `Node`/`Edge` and drive canvas interactions, so
// they live here in the editor rather than in the headless @foresthubai/workflow-core.
// Core exposes the pure primitive (`getPorts`); the React Flow coupling stays
// on this side of the boundary.

import { Edge, Node } from "@xyflow/react";
import { getPorts, NodeRegistry, type NodeData, type NodeDefinition } from "@foresthubai/workflow-core/node";
import { type EdgeType } from "@foresthubai/workflow-core/edge";

/** Check whether a node already has tool-input edges (for mutual exclusion). */
function hasToolInputEdge(nodeId: string, nodeData: NodeData, edges: Edge[]): boolean {
  const ports = getPorts(nodeData);
  return edges.some((e) => e.target === nodeId && ports.input.some((p) => p.type === "tool" && p.id === e.targetHandle));
}

/** Check whether a node already has control-flow edges (for mutual exclusion). */
function hasControlFlowEdge(nodeId: string, nodeData: NodeData, edges: Edge[]): boolean {
  const ports = getPorts(nodeData);
  return edges.some((e) => {
    if (e.target === nodeId) {
      return ports.input.some((p) => p.type === "control" && p.id === e.targetHandle);
    }
    if (e.source === nodeId) {
      return ports.output.some((p) => p.type === "control" && p.id === e.sourceHandle);
    }
    return false;
  });
}

/**
 * Check whether an output port can accept at least one more outgoing edge.
 * Used by the contextual "+" button on output ports.
 * Takes the node's own data rather than the nodes array so per-node components
 * (BaseNode) can call it without subscribing to all nodes.
 */
export function canPortAcceptEdge(nodeData: NodeData, handleId: string, edges: Edge[]): boolean {
  const ports = getPorts(nodeData);
  const port = ports.output.find((p) => p.id === handleId);
  if (!port) return false;

  // Tool output ports always accept multiple edges (an agent wires up many tools).
  // A control output port accepts a single edge unless the node can branch.
  if (port.type === "control" && !NodeRegistry.getByType(nodeData.type)?.canBranch) {
    if (edges.some((e) => e.source === nodeData.id && e.sourceHandle === handleId)) return false;
  }

  // Mutual exclusion: control output blocked when node has tool-input edges
  // (Tool output is exempt — never blocked)
  if (port.type === "control" && hasToolInputEdge(nodeData.id, nodeData, edges)) return false;

  return true;
}

/**
 * Filter node definitions to those that can connect to a given output port.
 * Returns definitions whose nodes have an input port matching the origin's port type.
 */
export function getCompatibleNodeDefs(
  originNodeId: string,
  originHandleId: string,
  nodes: Node<NodeData>[],
  edges: Edge[],
  allNodeDefs: NodeDefinition[],
  isFunctionCanvas: boolean,
): NodeDefinition[] {
  const originNode = nodes.find((n) => n.id === originNodeId);
  if (!originNode) return [];

  const originPorts = getPorts(originNode.data);
  const originPort = originPorts.output.find((p) => p.id === originHandleId);
  if (!originPort) return [];

  const originPortType = originPort.type; // "control" | "tool"

  return allNodeDefs.filter((def) => {
    if (def.isUnremovable) return false;

    if (def.isSingleton && nodes.some((n) => n.data.type === def.type)) return false;

    // Triggers have no inputs — skip on function canvas and when looking for input ports
    if (isFunctionCanvas && def.category === "Trigger") return false;

    // Check candidate has a matching input port
    const candidatePorts = getPorts({ type: def.type } as NodeData);
    return candidatePorts.input.some((p) => p.type === originPortType);
  });
}

export const isValidConnection = (
  sourceId: string | null,
  targetId: string | null,
  sourceHandleId: string | null | undefined,
  targetHandleId: string | null | undefined,
  nodes: Node<NodeData>[],
  edges: Edge[],
): false | EdgeType => {
  // All handles must be present
  if (sourceHandleId == null || targetHandleId == null || sourceId == null || targetId == null) return false;

  // Find source and target nodes
  const srcNode = nodes.find((n) => n.id === sourceId);
  const tgtNode = nodes.find((n) => n.id === targetId);
  if (!srcNode || !tgtNode) return false;

  // Source-side checks via canPortAcceptEdge (multiple-outgoing + mutual exclusion)
  if (!canPortAcceptEdge(srcNode.data, sourceHandleId, edges)) return false;

  // Get ports using centralized dispatcher
  const sourcePorts = getPorts(srcNode.data);
  const targetPorts = getPorts(tgtNode.data);

  const sourcePort = sourcePorts.output.find((p) => p.id === sourceHandleId);
  const targetPort = targetPorts.input.find((p) => p.id === targetHandleId);
  if (!sourcePort || !targetPort) return false;

  // Only allow connections between same port types
  if (sourcePort.type !== targetPort.type) return false;

  // Target-side mutual exclusion checks
  const portType = sourcePort.type as EdgeType;

  if (portType === "tool") {
    // Connecting a tool input on the target — reject if target already has control connections
    if (hasControlFlowEdge(tgtNode.id, tgtNode.data, edges)) return false;
  }

  if (portType === "control") {
    // Connecting a control port — reject if target already has tool INPUT connections
    if (hasToolInputEdge(tgtNode.id, tgtNode.data, edges)) return false;
  }

  return portType;
};
