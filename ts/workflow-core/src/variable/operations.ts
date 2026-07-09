// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { NodeOutput } from "../node";
import type { Reference } from "../api";
import type { ApiVariable } from "./Variable";
import { isToolFlow, type EdgeType, type Edge } from "../edge";
import { generateId } from "../id";
import type { Variable } from "./Variable";

// ============================================================================
// Key Helpers
// ============================================================================

/** Compute the canonical map key for any CanvasVariable (or AvailableVariable). */
export function varKey(v: Variable): string {
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
export function nodeOutputVarKey(nodeId: string, outputId: string): string {
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
      return nodeOutputVarKey(ref.srcId, ref.varId);
  }
}

// ============================================================================
// Variable UID Helpers for dynamic variable definitions (e.g. Agent output definitions)
// ============================================================================

/** Create a Variable from a NodeOutput by assigning a uid. If it already has a uid, return as-is. */
export function ensureUid(v: NodeOutput | ApiVariable): ApiVariable {
  if ("uid" in v && v.uid) return v as ApiVariable;
  return { uid: generateId(), name: v.name, dataType: v.dataType };
}

/** Ensure every NodeOutput/Variable in an array has a uid. */
export function ensureUids(vars: (NodeOutput | ApiVariable)[]): ApiVariable[] {
  return vars.map(ensureUid);
}

/** Get the binding key for a Variable — always its uid. */
export function paramKey(p: ApiVariable): string {
  return p.uid;
}

/**
 * Pure function that computes available variables for a canvas from its own
 * variables record + edges. Function canvases are self-contained: only their
 * own declared variables, node outputs, and function arguments are visible;
 * main-canvas state is never merged in.
 *
 * Only `type`/`target` are read, but the param takes the shared structural
 * {@link Edge} so there's one edge shape across core — workflow-builder
 * still passes its React Flow `Edge[]` without an adapter, and core stays free
 * of `@xyflow/react`.
 */
export function computeAvailableVariables(
  variables: Record<string, Variable>,
  canvasEdges: readonly Edge[],
): { list: Variable[]; lookup: Record<string, Variable> } {
  const list: Variable[] = [];
  const lookup: Record<string, Variable> = {};

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
