import type { Expression, Schemas } from "../api";
import type { ApiVariable } from "../variable";
import type { DataType } from "../parameter";

export type FunctionInfo = Schemas["FunctionInfo"];

/**
 * A function output: its declaration (`uid`/`name`/`dataType`) bundled with the
 * `expression` that produces it (evaluated in callee scope at the function's end).
 * Acts as a supertype of {@link ApiVariable}.
 */
export interface OutputAssignment {
  uid: string;
  name: string;
  dataType: DataType;
  expression: Expression;
}

/**
 * The domain function declaration: a signature with its outputs bundled
 * (declaration + assignment per output).
 * Separate from the function body (which is a canvas of nodes, edges, variables).
 */
export interface FunctionDeclaration {
  id: string;
  version: number;
  name: string;
  arguments: ApiVariable[];
  outputs: OutputAssignment[];
}

/**
 * Project a declaration to the flat call-site signature, dropping the expressions
 * (the caller has no business storing the callee's internals). Used only when
 * crossing from declaration to a call-site snapshot — dropping or migrating a
 * `FunctionCall` node — and by serialization. Never used to represent a function
 * within the domain.
 */
export function toFunctionInfo(fn: FunctionDeclaration): FunctionInfo {
  return {
    id: fn.id,
    version: fn.version,
    name: fn.name,
    arguments: fn.arguments,
    returns: fn.outputs.map(({ uid, name, dataType }) => ({ uid, name, dataType })),
  };
}
