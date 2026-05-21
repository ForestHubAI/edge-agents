// Public surface of the variable module. The discriminated-union types live in
// ./Variable; the key/lookup/uid helpers and availability computation live in
// ./operations. This file is a barrel only. Mirrors channel/memory/model.

export type { NodeOutputVariable, DeclaredVariable, FunctionArgVariable, Variable } from "./Variable";
export {
  varKey as canvasVarKey,
  declaredVarKey,
  fnargKey,
  nodeOutputVarKey as nodeOutputVariableKey,
  refToLookupKey,
  ensureUid,
  ensureUids,
  paramKey,
  computeAvailableVariables,
} from "./operations";
