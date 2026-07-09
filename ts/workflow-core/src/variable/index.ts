// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// Public surface of the variable module. The discriminated-union types live in
// ./Variable; the key/lookup/uid helpers and availability computation live in
// ./operations. This file is a barrel only. Mirrors channel/memory/model.

export type { ApiVariable, NodeOutputVariable, DeclaredVariable, FunctionArgVariable, Variable } from "./Variable";
export {
  varKey,
  declaredVarKey,
  fnargKey,
  nodeOutputVarKey,
  refToLookupKey,
  ensureUid,
  ensureUids,
  paramKey,
  computeAvailableVariables,
} from "./operations";
