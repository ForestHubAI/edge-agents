// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { Schemas } from "../api";
import type { DataType } from "../api";

export type ApiVariable = Schemas["Variable"]; // Differentiate from domain variable type

export type NodeOutputVariable = { kind: "node"; nodeId: string; outputId: string; name: string; dataType: DataType };
export type DeclaredVariable = { kind: "declared"; uid: string; name: string; dataType: DataType; initialValue?: unknown };
export type FunctionArgVariable = { kind: "fnarg"; uid: string; name: string; dataType: DataType };

export type Variable = NodeOutputVariable | DeclaredVariable | FunctionArgVariable;
