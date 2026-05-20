import type { Edge } from "@xyflow/react";
import type { DataType, Expression, NodeDefinition, NodeInstance, Reference } from "../../node";
import type { ChannelInstance } from "../../channel";
import { NodeCategory } from "../../node";
import type { AvailableVariable, DeclaredVariable, NodeOutputVariable } from "../../variable";
import type { Diagnostic, DiagnosticCategory } from "../diagnostics";

// ============================================================================
// Variable builders
// ============================================================================

export function makeDeclaredVar(overrides: Partial<DeclaredVariable> = {}): AvailableVariable {
  return {
    kind: "declared",
    uid: "v1",
    name: "count",
    dataType: "int" as DataType,
    ...overrides,
  };
}

export function makeNodeOutputVar(overrides: Partial<NodeOutputVariable> = {}): AvailableVariable {
  return {
    kind: "node",
    nodeId: "n1",
    outputId: "output",
    name: "result",
    dataType: "int" as DataType,
    ...overrides,
  };
}

/** Build an `availableVariables` map from a list of `AvailableVariable` entries. */
export function makeAvailableVars(vars: AvailableVariable[]): Record<string, AvailableVariable> {
  const map: Record<string, AvailableVariable> = {};
  for (const v of vars) {
    const key = v.kind === "declared" ? `declared:${v.uid}` : v.kind === "fnarg" ? `fnarg:${v.uid}` : `${v.nodeId}:${v.outputId}`;
    map[key] = v;
  }
  return map;
}

// ============================================================================
// Expression / Reference builders
// ============================================================================

export function makeExpression(expression: string, dataType: DataType = "int", references: Reference[] = []): Expression {
  return { expression, references, dataType };
}

export function makeDeclaredRef(uid: string): Reference {
  return { srcId: "declared", varId: uid };
}

// ============================================================================
// Edge builder
// ============================================================================

export function makeEdge(
  id: string,
  source: string,
  sourceHandle: string,
  target: string,
  targetHandle: string,
  overrides: Partial<Edge> = {},
): Edge {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    type: "control",
    ...overrides,
  } as Edge;
}

// ============================================================================
// Channel builders
// ============================================================================

export function makeChannel(overrides: Partial<ChannelInstance> = {}): ChannelInstance {
  return {
    id: "ch1",
    label: "GPIO 4",
    type: "GPIOIN",
    arguments: {},
    ...overrides,
  };
}

export function makeChannels(channels: ChannelInstance[]): Record<string, ChannelInstance> {
  const map: Record<string, ChannelInstance> = {};
  for (const v of channels) map[v.id] = v;
  return map;
}

// ============================================================================
// Node instance builder — untyped escape hatch
// ============================================================================

/**
 * Build a minimal NodeInstance. Tests assert against the shape `computeNodeDiagnostics`
 * sees (arguments record + type discriminator), not against the strict per-type shapes,
 * so we widen to `NodeInstance` via unknown at the boundary.
 */
export function makeNode(type: string, args: Record<string, unknown>, overrides: Record<string, unknown> = {}): NodeInstance {
  return { id: "n1", type, arguments: args, ...overrides } as unknown as NodeInstance;
}

// ============================================================================
// Synthetic NodeDefinition builder
// ============================================================================

export function makeNodeDef(overrides: Partial<NodeDefinition> = {}): NodeDefinition {
  return {
    type: "Synthetic" as NodeDefinition["type"],
    label: "Synthetic Node",
    category: NodeCategory.Input,
    description: "Synthetic node used only in tests",
    parameters: [],
    ...overrides,
  };
}

// ============================================================================
// Diagnostic assertion helpers
// ============================================================================

export function diagsOfCategory(diags: Diagnostic[], category: DiagnosticCategory): Diagnostic[] {
  return diags.filter((d) => d.category === category);
}

export function hasDiag(diags: Diagnostic[], predicate: (d: Diagnostic) => boolean): boolean {
  return diags.some(predicate);
}
