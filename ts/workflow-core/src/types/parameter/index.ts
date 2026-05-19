export * from "./parameter";
export * from "./output";
export * from "./display";

import type { Schemas } from "../../api";
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
