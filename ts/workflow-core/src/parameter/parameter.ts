import type { Expression, Reference } from "../api";
import type { ChannelType } from "../channel";
import type { MemoryType } from "../memory";
import type { ModelType, ModelCapability } from "../model";
import { refToLookupKey } from "../variable";
import type { Schemas } from "../api";

export type DataType = Schemas["DataType"];

/**
 * A field that is either a static value of T, or a function that derives T
 * from the owning node's current arguments. Scope is strictly args-only —
 * no access to variables, IO labels, or other canvas state. For wider
 * context, use a purpose-named accessor (e.g. resolveExpressionType).
 */
export type FromArgs<T> = T | ((args: Record<string, unknown>) => T);

/** Unwrap a FromArgs value against the current node arguments. */
export function unwrapFromArgs<T>(value: FromArgs<T>, args: Record<string, unknown>): T {
  return typeof value === "function" ? (value as (args: Record<string, unknown>) => T)(args) : value;
}

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
   * Escape hatch for the variableSelect case: when set, points to the id of a sibling
   * variableSelect parameter. If that parameter holds a live Reference, the expressionType
   * is taken from the referenced variable. Falls back to `expressionType` otherwise.
   */
  fromReference?: string;
  /**
   * Required: An expression always has a value object never an unset state.
   */
  default: Expression;
}

// Reference-select parameters: pick an external entity by id. No `default`.

export interface VariableSelectParam {
  type: "variableSelect";
  default?: never;
}

// Model reference parameter — selects a model id from the static catalog (props)
// unioned with declared custom models, filtered by model type and capability.
export interface ModelSelectParam {
  type: "modelSelect";
  /** Model types this slot accepts (e.g. ["LLMModel"]). Static list or args-derived lambda. */
  modelType: FromArgs<ModelType[]>;
  /** Optional capability filter (e.g. ["chat"]) applied to catalog and declared models alike. */
  capabilities?: FromArgs<ModelCapability[]>;
  default?: never;
}

export interface ChannelSelectParam {
  type: "channelSelect";
  /** Channel types this slot accepts. Static list or args-derived lambda. */
  channelType: FromArgs<ChannelType[]>;
  default?: never;
}

export interface MemorySelectParam {
  type: "memorySelect";
  /** Memory types this slot accepts (e.g. ["VectorDatabase"]). Static list or args-derived lambda. */
  memoryType: FromArgs<MemoryType[]>;
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
export type ReferenceSelectParam = VariableSelectParam | ChannelSelectParam | MemorySelectParam | ModelSelectParam;

export function isReferenceSelectParam(param: Parameter): param is ParameterBase & ReferenceSelectParam {
  return (
    param.type === "variableSelect" || param.type === "channelSelect" || param.type === "memorySelect" || param.type === "modelSelect"
  );
}

export type Parameter =
  | (ParameterBase & BasicParam)
  | (ParameterBase & VariableSelectParam)
  | (ParameterBase & StringParam)
  | (ParameterBase & BoolParam)
  | (ParameterBase & WeekdaysParam)
  | (ParameterBase & SelectionParam)
  | (ParameterBase & MemorySelectParam)
  | (ParameterBase & ModelSelectParam)
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
 * (type taken from a live variableSelect sibling parameter) and falls back to the
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

/** Resolve a capability filter (ModelSelectParam) for the current node arguments. */
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

/** Resolve the allowed memory types for a MemorySelectParam. */
export function resolveMemoryTypes(param: MemorySelectParam, args: Record<string, unknown>): MemoryType[] {
  return unwrapFromArgs(param.memoryType, args);
}

/** Resolve the allowed model types for a ModelSelectParam. */
export function resolveModelTypes(param: ModelSelectParam, args: Record<string, unknown>): ModelType[] {
  return unwrapFromArgs(param.modelType, args);
}
