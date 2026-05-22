import { NodeType } from "./Node";
import { NodeCategory, NodeTag } from "./constants";
import { OutputParameter, Parameter } from "../parameter";

/**
 * NodeDefinition describes static class-level node metadata.
 * Methods (getPorts) are optional and take no arguments for static port definitions.
 * Instance-dependent behavior lives in NodeBehavior.ts instead.
 */
export interface NodeDefinition {
  type: NodeType; // Node discriminator
  label: string; // Human-readable, displayed name
  category: NodeCategory; // Category for grouping (e.g., 'Input', 'Output', 'Logic')
  description: string; // Description of what the node does
  parameters: Parameter[]; // Parameter definitions for the node.
  outputs?: OutputParameter[]; // Declarative output definitions — consumed by getNodeAvailableOutput() to compute a node's outputs
  tags?: NodeTag[]; // Cross-cutting subsystem labels (Network, Pin, Serial, ...)
  isUnremovable?: boolean; // Whether the node cannot be added or removed by a user
  isSingleton?: boolean; // Whether only one instance of this node can exist in a canvas
  canBranch?: boolean; // Whether the control output port may fan out to multiple branches (tool output ports are always multi-target)
}

// =============================================================================
// PORT DEFINITIONS
// =============================================================================

// Port represents a connectable port of a node
export interface Port {
  id: string;
  type: "control" | "tool";
  label?: string;
}

export interface PortDefinitions {
  input: Port[];
  output: Port[];
}
