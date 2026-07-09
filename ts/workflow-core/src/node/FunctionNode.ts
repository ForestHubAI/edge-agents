// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { NodeBase } from "./Node";
import type { Expression } from "../api";
import type { FunctionInfo } from "../function";
import type { DataType } from "../api";
import { OutputBinding } from "../parameter";
import { NodeDefinition } from "./NodeDefinition";
import { NodeCategory } from "./constants";
import { paramKey } from "../variable";

// Function Call Node - invokes a user-defined function.
// Arguments are flat — keyed by Variable uid. Input argument uids map to Expression,
// return uids map to OutputBinding. Same shape as every other node, so the rest of
// the system (parameter editors, output bindings, merge/update) treats FunctionCall
// uniformly. Outputs are derived on-the-fly via buildFunctionNodeDef from
// functionInfo.returns — there is no registered NodeDefinition.
export interface FunctionCallNode extends NodeBase {
  type: "FunctionCall";
  functionInfo: FunctionInfo; // Snapshot at creation; may be stale vs registry
  // Flat bag keyed by Variable uid (Expression for args, OutputBinding for returns),
  // plus the reserved `toolDescription` key (string) for the tool-mode parameter.
  arguments: Record<string, Expression | OutputBinding | string>;
}

export type FunctionCallNodeType = "FunctionCall";

// FunctionNodeDefinition extends NodeDefinition with function-specific fields
// Used by NodeLibrary to create new FunctionCall nodes
export interface FunctionNodeDefinition extends NodeDefinition {
  type: "FunctionCall";
  functionInfo: FunctionInfo; // Metadata about the function being called
}

/**
 * Build a FunctionCall NodeDefinition from FunctionInfo. Pure — takes an
 * optional translator function so the headless validator can call it without
 * an i18n runtime; workflow-builder passes `i18n.t.bind(i18n)` to get
 * translated descriptions. Defaults to identity (returns the key) when no
 * translator is supplied; validation logic ignores description strings.
 */
export function buildFunctionNodeDef(
  fn: FunctionInfo,
  t: (key: string, params?: Record<string, unknown>) => string = (key) => key,
): FunctionNodeDefinition {
  return {
    type: "FunctionCall",
    functionInfo: fn,
    label: fn.name,
    category: NodeCategory.Function,
    description: t("builder.functionCallDesc", { name: fn.name }),
    parameters: [
      ...fn.arguments.map((param) => ({
        id: paramKey(param),
        label: param.name,
        description: t("builder.functionParamDesc", { name: param.name }),
        type: "expression" as const,
        expressionType: param.dataType as DataType,
        default: { expression: "", references: [], dataType: param.dataType as DataType },
        activationRules: [{ type: "isControlFlow" as const }],
      })),
      {
        id: "toolDescription",
        label: "Tool Description",
        description: "Description shown to the agent when this function is wired as a tool",
        type: "string" as const,
        multiline: true,
        activationRules: [{ type: "isToolInput" as const }],
      },
    ],
    outputs: fn.returns.map((ret) => ({
      id: paramKey(ret),
      label: ret.name,
      type: "static" as const,
      dataType: ret.dataType as DataType,
    })),
  };
}
