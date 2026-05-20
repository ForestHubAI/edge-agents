import { Edge, Node } from "@xyflow/react";
import { NodeInstance, NodeDefinition } from ".";
import { getPorts } from "./NodeMethods";
import { type EdgeType } from "../edge";

/**
 * Determine whether a node is currently used as a tool input
 * (i.e. its tool-input port has an incoming edge).
 */
export function isNodeUsedAsTool(nodeId: string, nodeData: NodeInstance, edges: Edge[]): boolean {
  const ports = getPorts(nodeData);
  const toolInputs = ports.input.filter((p) => p.type === "tool");
  if (toolInputs.length === 0) return false;
  return edges.some((e) => e.target === nodeId && toolInputs.some((p) => p.id === e.targetHandle));
}

/** Check whether a node already has tool-input edges (for mutual exclusion). */
function hasToolInputEdge(nodeId: string, nodeData: NodeInstance, edges: Edge[]): boolean {
  const ports = getPorts(nodeData);
  return edges.some(
    (e) => e.target === nodeId && ports.input.some((p) => p.type === "tool" && p.id === e.targetHandle),
  );
}

/** Check whether a node already has control-flow edges (for mutual exclusion). */
function hasControlFlowEdge(nodeId: string, nodeData: NodeInstance, edges: Edge[]): boolean {
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
 */
export function canPortAcceptEdge(
  nodeId: string,
  handleId: string,
  nodes: Node<NodeInstance>[],
  edges: Edge[],
): boolean {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return false;

  const ports = getPorts(node.data);
  const port = ports.output.find((p) => p.id === handleId);
  if (!port) return false;

  // Non-Agent nodes: only one outgoing edge per output port
  if (node.data.type !== "Agent") {
    if (edges.some((e) => e.source === nodeId && e.sourceHandle === handleId)) return false;
  }

  // Mutual exclusion: control output blocked when node has tool-input edges
  // (Tool output is exempt — never blocked)
  if (port.type === "control" && hasToolInputEdge(nodeId, node.data, edges)) return false;

  return true;
}

/**
 * Filter node definitions to those that can connect to a given output port.
 * Returns definitions whose nodes have an input port matching the origin's port type.
 */
export function getCompatibleNodeDefs(
  originNodeId: string,
  originHandleId: string,
  nodes: Node<NodeInstance>[],
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
    const candidatePorts = getPorts({ type: def.type } as NodeInstance);
    return candidatePorts.input.some((p) => p.type === originPortType);
  });
}

export const isValidConnection = (
  sourceId: string | null,
  targetId: string | null,
  sourceHandleId: string | null | undefined,
  targetHandleId: string | null | undefined,
  nodes: Node<NodeInstance>[],
  edges: Edge[],
): false | EdgeType => {
  // All handles must be present
  if (sourceHandleId == null || targetHandleId == null || sourceId == null || targetId == null) return false;

  // Find source and target nodes
  const srcNode = nodes.find((n) => n.id === sourceId);
  const tgtNode = nodes.find((n) => n.id === targetId);
  if (!srcNode || !tgtNode) return false;

  // Source-side checks via canPortAcceptEdge (multiple-outgoing + mutual exclusion)
  if (!canPortAcceptEdge(sourceId, sourceHandleId, nodes, edges)) return false;

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
