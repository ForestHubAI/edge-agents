import type { DataType, NodeOutput, Reference, Variable } from "../node";
import { isToolFlow, type EdgeType } from "../edge";

// ============================================================================
// Discriminated Union Variable Types
// ============================================================================

export type NodeOutputVariable = { kind: "node"; nodeId: string; outputId: string; name: string; dataType: DataType };
export type DeclaredVariable = { kind: "declared"; uid: string; name: string; dataType: DataType; initialValue?: unknown };
export type FunctionArgVariable = { kind: "fnarg"; uid: string; name: string; dataType: DataType };
export type CanvasVariable = NodeOutputVariable | DeclaredVariable | FunctionArgVariable;

export type AvailableVariable = CanvasVariable;

// ============================================================================
// Key Helpers
// ============================================================================

/** Compute the canonical map key for any CanvasVariable (or AvailableVariable). */
export function canvasVarKey(v: CanvasVariable): string {
  switch (v.kind) {
    case "node":
      return `${v.nodeId}:${v.outputId}`;
    case "declared":
      return `declared:${v.uid}`;
    case "fnarg":
      return `fnarg:${v.uid}`;
  }
}

/** Key for a declared variable: `declared:<uid>` */
export function declaredVarKey(uid: string): string {
  return `declared:${uid}`;
}

/** Key for a function argument variable: `fnarg:<uid>` */
export function fnargKey(uid: string): string {
  return `fnarg:${uid}`;
}

/** Key for a node output variable: `<nodeId>:<outputId>` */
export function nodeOutputVariableKey(nodeId: string, outputId: string): string {
  return `${nodeId}:${outputId}`;
}

// ============================================================================
// Reference → Lookup Key
// ============================================================================

/** Convert a Reference to the canonical lookup key used in the variables record. */
export function refToLookupKey(ref: Reference): string {
  switch (ref.srcId) {
    case "declared":
      return declaredVarKey(ref.varId);
    case "fnarg":
      return fnargKey(ref.varId);
    default:
      return nodeOutputVariableKey(ref.srcId, ref.varId);
  }
}

// ============================================================================
// Variable UID Helpers for dynamic variable definitions (e.g. Agent output definitions)
// ============================================================================

/** Create a Variable from a NodeOutput by assigning a uid. If it already has a uid, return as-is. */
export function ensureUid(v: NodeOutput | Variable): Variable {
  if ("uid" in v && v.uid) return v as Variable;
  return { uid: crypto.randomUUID(), name: v.name, dataType: v.dataType };
}

/** Ensure every NodeOutput/Variable in an array has a uid. */
export function ensureUids(vars: (NodeOutput | Variable)[]): Variable[] {
  return vars.map(ensureUid);
}

/** Get the binding key for a Variable — always its uid. */
export function paramKey(p: Variable): string {
  return p.uid;
}

/**
 * Pure function that computes available variables for a canvas from its own
 * variables record + edges. Function canvases are self-contained: only their
 * own declared variables, node outputs, and function arguments are visible;
 * main-canvas state is never merged in.
 *
 * Edges are only inspected for two fields (`type`, `target`) — the inline
 * structural shape lets workflow-builder pass its React Flow `Edge[]` without
 * an adapter while core stays free of `@xyflow/react`.
 */
export function computeAvailableVariables(
  variables: Record<string, CanvasVariable>,
  canvasEdges: ReadonlyArray<{ type?: string | null; target: string }>,
): { list: AvailableVariable[]; lookup: Record<string, AvailableVariable> } {
  const list: AvailableVariable[] = [];
  const lookup: Record<string, AvailableVariable> = {};

  // Node outputs routed to a tool port are scoped to the agent — exclude them.
  const toolNodeIds = new Set<string>();
  for (const edge of canvasEdges) {
    if (isToolFlow(edge.type as EdgeType)) toolNodeIds.add(edge.target);
  }

  for (const [key, variable] of Object.entries(variables)) {
    if (variable.kind === "node" && toolNodeIds.has(variable.nodeId)) continue;
    list.push(variable);
    lookup[key] = variable;
  }

  return { list, lookup };
}
