import type { Reference } from "../api";
import { DataType, FromArgs, unwrapFromArgs } from "./Parameter";

// ============================================================================
// RUNTIME VALUES
// ============================================================================

/**
 * Runtime binding stored for a static output. `active=false` means the output
 * is discarded — no variable is produced or assigned. mode/name/target are kept
 * as draft state when inactive so the row can round-trip through an off→on
 * toggle without losing the user's prior choice. The slot's dataType comes from
 * the StaticOutput definition — not carried here.
 */
export type OutputBinding = { active: boolean; mode: "emit"; name: string } | { active: boolean; mode: "assign"; target: Reference };

/**
 * Runtime entry stored in a list output. Each entry is a user-authored
 * output declaration: either a new variable (emit) with its own uid/name/dataType,
 * or a routing to an existing variable (assign). `name` doubles as the JSON
 * property name in the LLM's structured response and (for emit) the new
 * variable's display name in canvas scope; it must be non-empty and unique
 * within the OutputList parameter (validated by diagnostics).
 *
 * Unlike OutputBinding, the slot's dataType is carried on the declaration
 * itself as a contract — staleness against the target (assign mode) is a
 * diagnostic, not a silent retype. No "discard" mode: removing the entry is
 * how you discard it.
 */
export type OutputDeclaration =
  | { mode: "emit"; uid: string; name: string; dataType: DataType }
  | { mode: "assign"; name: string; dataType: DataType; target: Reference };

// ============================================================================
// OUTPUT PARAMETER DEFINITIONS
// ============================================================================

/**
 * A fixed output produced by every instance of this node type. The `id` is
 * both the field name inside `node.arguments` where the OutputBinding lives
 * and the default emit variable name (overridable via the binding's `name`).
 * The dataType may be static or an args-derived lambda.
 */
export interface StaticOutput {
  id: string;
  label: string;
  type: "static";
  dataType: FromArgs<DataType>;
}

/** Resolve a StaticOutput's dataType for the current node arguments. */
export function resolveStaticOutputDataType(output: StaticOutput, args: Record<string, unknown>): DataType {
  return unwrapFromArgs(output.dataType, args);
}

/**
 * A user-managed list of outputs. Entries live in `node.arguments[id]` as
 * `OutputDeclaration[]` — the UI CRUDs the list directly, and each entry
 * contributes one output. Used for Agent's outputDeclarations.
 */
export interface OutputList {
  id: string;
  label: string;
  type: "list";
}

/** Output parameters mirror input parameters: intersected with ParameterBase for id/label/etc. */
export type OutputParameter = StaticOutput | OutputList;
