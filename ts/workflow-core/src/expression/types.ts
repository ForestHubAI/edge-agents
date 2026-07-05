// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { NodeOutput } from "../node";
import type { DataType, Expression } from "../api";
import type { Variable } from "../variable";
import { refToLookupKey } from "../variable";

// ResolvedExpr represents an expression with its variable references resolved to runtime variables
export interface ResolvedExpr {
  expression: string; // The expression string with variable references, e.g. "${} + ${}"
  variables: (NodeOutput | null)[]; // List of variables used in the expression (null if stale/invalid)
  expectedType: DataType; // The expected data type of the expression result
}

// Resolve an expression by converting variable references to runtime variables
export function resolveExpression(apiExpr: Expression, availableVars: Record<string, Variable>): ResolvedExpr {
  return {
    expression: apiExpr.expression,
    expectedType: apiExpr.dataType,
    variables: apiExpr.references.map((ref) => {
      if (!ref.varId) return null;
      const key = refToLookupKey(ref);
      const v = availableVars[key];
      return v ? { name: v.name, dataType: v.dataType } : null;
    }),
  };
}

// Check if a value is an expression (has references array)
export function isExpression(value: unknown): value is Expression {
  return typeof value === "object" && value !== null && "expression" in value && "references" in value;
}
