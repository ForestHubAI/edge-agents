import type { Schemas } from "../../api";
import type { Expression, Reference } from "../node";
import type { ChannelType } from "../channel";
import { refToLookupKey } from "@/visual-builder/utils/variables";
import { DataType, FromArgs, unwrapFromArgs } from ".";

type ModelCapability = Schemas["ModelCapability"];

// ============================================================================
// Parameter definitions
// ============================================================================

export interface ParameterBase {
  id: string;
  label: string;
  description: string;
  optional?: boolean;
  /** Parameter is only active (visible, validated, serialized) when all rules are met. */
  activationRules?: ActivationRule[];
}

export interface BasicParam {
  type: "int" | "float" | "time";
  default?: number | string;
}

export interface StringParam {
  type: "string";
  multiline?: boolean;
  default?: string;
}

export interface BoolParam {
  type: "bool";
  default: boolean;
}

export interface WeekdaysParam {
  type: "weekdays";
  default: string[];
}

export interface SelectionParam {
  type: "selection";
  options: Array<{ value: string; label: string }>;
  default?: string;
}

export interface ExpressionParam {
  type: "expression";
  /** Type can be dynamic (static value or args-only lambda). */
  expressionType: FromArgs<DataType>;
  /**
   * Escape hatch for the variable-reference case: when set, points to the id of a sibling
   * variable-reference parameter. If that parameter holds a live Reference, the expressionType
   * is taken from the referenced variable. Falls back to `expressionType` otherwise.
   */
  fromReference?: string;
  default?: Expression;
}

// Reference-select parameters: pick an external entity by id. No `default`.

export interface VariableReferenceParam {
  type: "variable-reference";
  default?: never;
}

export interface RagCollectionParam {
  type: "rag-collection";
  default?: never;
}

// LLM model reference parameter — selects a model from active providers
export interface LLMModelParam {
  type: "llm-model";
  default?: never;
  capabilities?: FromArgs<ModelCapability[]>; // Optional filter
}

export interface ChannelSelectParam {
  type: "channelSelect";
  /** Channel types this slot accepts. Static list or args-derived lambda. */
  channelType: FromArgs<ChannelType[]>;
  default?: never;
}

/**
 * List parameter that binds an agent node to project-declared memory files,
 * each with an access mode (`r` = read-only, `rw` = read + write). The editor
 * holds the array directly; the API schema (`MemoryRef[]`) round-trips 1:1.
 */
export interface MemoryRefsParam {
  type: "memory-refs";
  default?: never;
}

/** Union of all reference-select parameter variants, used for type guards. */
export type ReferenceSelectParam = VariableReferenceParam | ChannelSelectParam | RagCollectionParam | LLMModelParam;

export function isReferenceSelectParam(param: Parameter): param is ParameterBase & ReferenceSelectParam {
  return param.type === "variable-reference" || param.type === "channelSelect" || param.type === "rag-collection" || param.type === "llm-model";
}

export type Parameter =
  | (ParameterBase & BasicParam)
  | (ParameterBase & VariableReferenceParam)
  | (ParameterBase & StringParam)
  | (ParameterBase & BoolParam)
  | (ParameterBase & WeekdaysParam)
  | (ParameterBase & SelectionParam)
  | (ParameterBase & RagCollectionParam)
  | (ParameterBase & LLMModelParam)
  | (ParameterBase & ExpressionParam)
  | (ParameterBase & ChannelSelectParam)
  | (ParameterBase & MemoryRefsParam);

// ============================================================================
// Parameter activation rules
// ============================================================================

/** Typed union of rules that control whether a parameter is active (visible, validated, serialized). */
export type ActivationRule =
  | { type: "parameterIn"; parameterId: string; values: unknown[] }
  | { type: "isControlFlow" }
  | { type: "isToolInput" };

/**
 * Evaluate whether a parameter is active (visible, validated, serialized) given current context.
 * All rules must be satisfied (AND logic). Undefined or empty array = always active.
 */
export function isParameterActive(param: Parameter, parameterValues: Record<string, unknown>, isToolInput: boolean): boolean {
  if (!param.activationRules?.length) return true;
  return param.activationRules.every((cond) => {
    switch (cond.type) {
      case "isControlFlow":
        return !isToolInput;
      case "isToolInput":
        return isToolInput;
      case "parameterIn":
        return cond.values.includes(parameterValues[cond.parameterId]);
    }
  });
}

// ============================================================================
// Parameter resolvers
// ============================================================================

/**
 * Resolve an ExpressionParam's expected dataType. Handles the `fromReference` escape hatch
 * (type taken from a live variable-reference sibling parameter) and falls back to the
 * declared FromArgs<DataType>.
 */
export function resolveExpressionType(
  param: ExpressionParam,
  args: Record<string, unknown>,
  variables: Record<string, { dataType: DataType }>,
): DataType {
  if (param.fromReference) {
    const ref = args[param.fromReference] as Reference | undefined;
    if (ref?.varId) {
      const v = variables[refToLookupKey(ref)];
      if (v) return v.dataType;
    }
  }
  return unwrapFromArgs(param.expressionType, args);
}

/** Resolve a capability filter (LLMModelParam) for the current node arguments. */
export function resolveCapabilities(
  param: { capabilities?: FromArgs<ModelCapability[]> },
  args: Record<string, unknown>,
): ModelCapability[] | undefined {
  return param.capabilities === undefined ? undefined : unwrapFromArgs(param.capabilities, args);
}

/** Resolve the allowed channel types for a ChannelSelectParam. */
export function resolveChannelTypes(param: ChannelSelectParam, args: Record<string, unknown>): ChannelType[] {
  return unwrapFromArgs(param.channelType, args);
}
