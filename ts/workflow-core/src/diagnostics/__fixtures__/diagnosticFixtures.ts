// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { Edge } from "../../edge";
import type { NodeDefinition, NodeData } from "../../node";
import type { DataType, Expression, Reference } from "../../api";
import type { Channel } from "../../channel";
import type { Memory } from "../../memory";
import { NodeCategory } from "../../node";
import type { Variable, DeclaredVariable, NodeOutputVariable } from "../../variable";
import type { Diagnostic, DiagnosticCategory } from "../diagnostics";

// ============================================================================
// Variable builders
// ============================================================================

export function makeDeclaredVar(overrides: Partial<DeclaredVariable> = {}): Variable {
  return {
    kind: "declared",
    uid: "v1",
    name: "count",
    dataType: "int" as DataType,
    ...overrides,
  };
}

export function makeNodeOutputVar(overrides: Partial<NodeOutputVariable> = {}): Variable {
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
export function makeAvailableVars(vars: Variable[]): Record<string, Variable> {
  const map: Record<string, Variable> = {};
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
  };
}

// ============================================================================
// Channel builders
// ============================================================================

export function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "ch1",
    label: "GPIO 4",
    type: "GPIOIN",
    arguments: {},
    ...overrides,
  };
}

export function makeChannels(channels: Channel[]): Record<string, Channel> {
  const map: Record<string, Channel> = {};
  for (const v of channels) map[v.id] = v;
  return map;
}

// ============================================================================
// Memory builders
// ============================================================================

export function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem1",
    label: "memory1",
    type: "MemoryFile",
    arguments: {},
    ...overrides,
  };
}

export function makeMemories(memories: Memory[]): Record<string, Memory> {
  const map: Record<string, Memory> = {};
  for (const m of memories) map[m.id] = m;
  return map;
}

// ============================================================================
// Node instance builder — untyped escape hatch
// ============================================================================

/**
 * Build a minimal NodeData. Tests assert against the shape `computeNodeDiagnostics`
 * sees (arguments record + type discriminator), not against the strict per-type shapes,
 * so we widen to `NodeData` via unknown at the boundary.
 */
export function makeNode(type: string, args: Record<string, unknown>, overrides: Record<string, unknown> = {}): NodeData {
  return { id: "n1", type, arguments: args, ...overrides } as unknown as NodeData;
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
