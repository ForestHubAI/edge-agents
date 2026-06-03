import type { Expression } from "../api";
import type { FunctionDeclaration, FunctionInfo } from "./FunctionDeclaration";
import { toFunctionInfo } from "./FunctionDeclaration";

/**
 * The two wire pieces a {@link FunctionDeclaration} splits into. The contract keeps
 * the signature (`functionInfo`) and the return-value expressions (`outputAssignments`)
 * apart; the domain bundles them on `outputs`. The function *body*
 * (nodes/edges/declaredVariables) is added separately by the workflow serializer —
 * this only handles the declaration ⇄ wire mapping.
 */
export interface SerializedFunction {
  functionInfo: FunctionInfo;
  outputAssignments: Record<string, Expression>;
}

/** Domain declaration → wire pieces: flatten the signature and lift each output's
 *  expression into the `outputAssignments` map keyed by output uid. */
export function serialize(fn: FunctionDeclaration): SerializedFunction {
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
