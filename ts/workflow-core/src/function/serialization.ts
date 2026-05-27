import type { Expression } from "../api";
import type { FunctionDeclaration, FunctionInfo } from "./FunctionDeclaration";
import { toFunctionInfo } from "./FunctionDeclaration";

/**
 * Domain declaration → the two wire pieces. The contract keeps the signature
 * (`functionInfo`) and the return-value expressions (`outputAssignments`) apart; the
 * domain bundles them on `outputs`. The function *body* (nodes/edges/declaredVariables)
 * is added separately by the workflow serializer — this only maps the declaration.
 * Flattens the signature and lifts each output's expression into the
 * `outputAssignments` map keyed by output uid.
 */
export function serialize(fn: FunctionDeclaration): { functionInfo: FunctionInfo; outputAssignments: Record<string, Expression> } {
  const outputAssignments: Record<string, Expression> = {};
  for (const o of fn.outputs) outputAssignments[o.uid] = o.expression;
  return { functionInfo: toFunctionInfo(fn), outputAssignments };
}

/** Wire pieces → domain declaration: bundle each `return` with its assignment. A
 *  return with no stored assignment gets an empty expression of the right dataType. */
export function deserialize(functionInfo: FunctionInfo, outputAssignments: Record<string, Expression>): FunctionDeclaration {
  return {
    id: functionInfo.id,
    version: functionInfo.version,
    name: functionInfo.name,
    arguments: functionInfo.arguments,
    outputs: functionInfo.returns.map((r) => ({
      uid: r.uid,
      name: r.name,
      dataType: r.dataType,
      expression: outputAssignments[r.uid] ?? { expression: "", references: [], dataType: r.dataType },
    })),
  };
}
