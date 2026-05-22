# Variable System

## Overview

The workflow builder lets users wire data between nodes. Underneath, three fundamental concepts make this work:

- **Node outputs** — the values a node produces (a sensor reading, an agent response, etc.)
- **Variables** — user-defined, named, uid-stable containers that exist independent of nodes
- **References** — pointers from expressions to the variables they contain

A `ReadPin` node might produce an output called `sensorValue` of type `int`. An expression on another node can reference it with `${sensorValue}`. That expression stores a `Reference` that points back to the ReadPin node's output slot, so the system knows where the value comes from even if the variable gets renamed. Everything binds by uid, not by name.

---

## API Layer

The API schema (`src/api/openapi.yaml`, `src/api/generated.ts`) defines the following data-carrying types.

### `Variable`

```
{ uid: string, name: string, dataType: DataType, initialValue?: unknown }
```

A single unified type used wherever a uid-stable variable is needed:

| Usage                   | `initialValue` | Location in JSON                                               |
| ----------------------- | -------------- | -------------------------------------------------------------- |
| Function argument       | ignored        | `FunctionInfo.arguments[]`                                     |
| Function return value   | ignored        | `FunctionInfo.returns[]`                                       |
| Declared variable       | used           | `Workflow.declaredVariables[]`, `Function.declaredVariables[]` |
| Agent output definition | ignored        | `AgentNode.arguments.outputDefinitions[]`                      |

The `uid` is the universal binding key. Expression references point to it, `FunctionCallNode.arguments.inputBindings` and `outputNames` are keyed by it.

### `Reference`

```
{ srcid: string, varId: string }
```

Lives inside `Expression.references[]`. Each `${}` placeholder in an expression string corresponds to one Reference in order. The two fields encode three cases:

| What it points to | `srcid`     | `varId`            |
| ----------------- | ----------- | ------------------ |
| Node output       | `<node ID>` | `<output slot ID>` |
| Declared variable | "declared"  | `<uid>`            |
| Function argument | "fnarg"     | `<uid>`            |

`srcid` is set to the node's ID when referencing a node output. For declared variables and function arguments, `srcId` acts as differentiating "type" parameter and `varId` is used to look up variables directly by their uid.

### `Expression`

```
{ expression: string, references: Reference[], dataType: DataType }
```

The `expression` string contains `${}` placeholders. Each placeholder maps positionally to the corresponding entry in `references[]`. For example, `"${} + ${}"` with two references means: first placeholder → `references[0]`, second → `references[1]`.

---

## Domain Layer

### Type re-exports (`src/types/node/index.ts`)

The domain layer re-exports the API types so the rest of the app imports from `@/types/node`:

```typescript
export type NodeOutput = { name: string; dataType: DataType };
export type Variable = Schemas["Variable"];
export type Reference = Schemas["Reference"];
export type Expression = Schemas["Expression"];
```

`NodeOutput` is a local domain type (not from the API schema) — a lightweight value descriptor with no identity. It appears on `NodeBase.output` as `Record<string, NodeOutput>`, keyed by an output slot ID (e.g. `"out-0"` for system nodes, or a uid for Agent/FunctionCall outputs). The `getOutput()` function in `NodeMethods.ts` computes this record from a node's arguments — deriving output name and type from things like an Agent's `outputDefinitions` or a ReadPin's `signalType`.

### Canvas variable system (`src/workflow-builder/utils/variables.ts`)

The canvas needs a unified record of all referenceable variables from multiple sources. It defines a discriminated union:

```typescript
type NodeOutputVariable = { kind: "node"; nodeId; outputId; name; dataType };
type DeclaredVariable = { kind: "declared"; uid; name; dataType; initialValue? };
type FunctionArgVariable = { kind: "fnarg"; uid; name; dataType };

type CanvasVariable = NodeOutputVariable | DeclaredVariable | FunctionArgVariable;
```

These are stored in `CanvasState.variables: Record<string, CanvasVariable>` with composite string keys:

| Kind         | Key format            | Example                   |
| ------------ | --------------------- | ------------------------- |
| `"node"`     | `<nodeId>:<outputId>` | `"ReadPin_abc:out-0"`     |
| `"declared"` | `"declared:<uid>"`    | `"declared:550e8400-..."` |
| `"fnarg"`    | `"fnarg:<uid>"`       | `"fnarg:7c9e6679-..."`    |

Key helpers: `variableKey()`, `declaredVarKey()`, `fnargKey()`, `canvasVarKey()`.

### Resolving references

`refToLookupKey(ref: Reference): string` converts a Reference into the matching canvas variable key:

- `srcid` present → `variableKey(srcid, varId)`
- `varId` starts with `"declared:"` → use as-is
- otherwise → `fnarg:${varId}`

This is used by `resolveExpression()` (to render expression displays), by `ParameterEditor` (to show which variable is selected), and by diagnostics (to validate references).

### Available variables

`useAvailableVariables(canvasId)` computes which variables are accessible on a given canvas. Each canvas is **fully self-contained** — function canvases do not see main-canvas variables. The only values crossing the scope boundary are function arguments, which arrive by value as `fnarg` variables. Node outputs connected as tools are excluded since their variables are scoped to the agent.

### Import/export mapping

On **import**: node outputs are computed via `getOutput()` → `NodeOutputVariable` entries; `declaredVariables[]` → `DeclaredVariable` entries; `FunctionInfo.arguments[]` → `FunctionArgVariable` entries.

On **export**: `DeclaredVariable` entries are extracted back to `Variable[]`; node outputs are serialized on nodes; function arguments are already in `FunctionInfo`.

---

## Key Files

| File                                                           | Role                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `src/api/openapi.yaml`                                         | Schema definitions for `Variable`, `Reference`, `Expression`            |
| `src/api/generated.ts`                                         | Generated TypeScript types matching the schema                          |
| `src/types/node/index.ts`                                      | Domain type re-exports, `NodeBase` interface                            |
| `src/types/node/NodeMethods.ts`                                | `getOutput()` — computes `NodeOutput` record from node arguments        |
| `src/types/node/NodeSerialization.ts`                          | Serialize/deserialize between API JSON and `NodeData`               |
| `src/types/node/AgentNode.ts`                                  | `outputDefinitions: Variable[]`                                         |
| `src/types/node/FunctionNode.ts`                               | `inputBindings`/`outputNames` keyed by Variable uid                     |
| `src/workflow-builder/utils/variables.ts`             | Canvas variable types, key helpers, `refToLookupKey()`                  |
| `src/workflow-builder/store/canvasStore.ts`           | `CanvasState.variables`, `computeVariablesFromNodes()`                  |
| `src/workflow-builder/hooks/useAvailableVariables.ts` | Computes the current canvas's variables (self-contained per canvas)     |
| `src/workflow-builder/utils/variables.ts`                        | Also exports `ensureUid()`, `paramKey()` — uid management utilities     |
| `src/workflow-builder/utils/expressions/types.ts`      | `resolveExpression()`, `ResolvedExpr` — expression ↔ display conversion |
| `src/workflow-builder/inputs/ExpressionInput.tsx`     | Builds `Reference` objects when user selects variables                  |
| `src/workflow-builder/inputs/ParameterEditor.tsx`     | Variable-reference dropdowns, uses `refToLookupKey()`                   |
| `src/workflow-builder/hooks/useImportExport.ts`       | Bidirectional conversion between API format and canvas stores           |
