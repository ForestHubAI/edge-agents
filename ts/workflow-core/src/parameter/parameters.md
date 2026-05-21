# Parameter Type System

Nodes and edges in the workflow builder are configured through parameters — typed fields that appear in the config panel when a node or edge is selected. Both use the same input-parameter type system, so the editing experience, validation, and serialization logic is shared.

Nodes additionally declare **output parameters** — typed slots for what the node produces into variable scope. Output parameters live alongside input parameters on `NodeDefinition` (in a separate `outputs` array) and store their runtime state in the same `node.arguments` bag, but they use their own variant types and are rendered through a dedicated output section of the config panel.

---

## 1. Type structure

### Input parameters (`src/types/parameter/parameter.ts`)

`Parameter = ParameterBase & Variant`. The `type` discriminator selects the variant:

| `type`                 | Variant                  | Extra fields                                              |
| ---------------------- | ------------------------ | --------------------------------------------------------- |
| `int`, `float`, `time` | `BasicParam`             | —                                                         |
| `string`               | `StringParam`            | `multiline?`                                              |
| `bool`                 | `BoolParam`              | `default: boolean` (required)                             |
| `weekdays`             | `WeekdaysParam`          | `default: string[]` (required)                            |
| `selection`            | `SelectionParam`         | `options: {value, label}[]`                               |
| `expression`           | `ExpressionParam`        | `expressionType`, `fromReference?`                        |
| `variable-reference`   | `VariableReferenceParam` | — (extends `ReferenceSelectBase`)                         |
| `memorySelect`         | `MemorySelectParam`      | `memoryType` (extends `ReferenceSelectBase`)              |
| `channelSelect`        | `ChannelSelectParam`     | `channelType` (extends `ReferenceSelectBase`)             |

**`ParameterBase` fields:** `id`, `label`, `description`, `optional?`, `default?`, `activationRules?`

`ParameterEditor` (`src/workflow-builder/inputs/ParameterEditor.tsx`) has an exhaustive `switch` on `parameter.type` — adding a new input variant without a corresponding `case` is a compile error.

`ExpressionParam.fromReference` is an escape hatch for the variable-reference case: when set, it points to the id of a sibling `variable-reference` parameter, and the expression's expected type is taken from whatever variable that sibling currently references (falling back to the declared `expressionType`).

### Output parameters (`src/types/parameter/output.ts`)

`OutputParameter = StaticOutput | OutputList`. Output parameters are declared on `NodeDefinition.outputs` (separate from `parameters`) and describe what the node produces into variable scope.

| `type`   | Variant        | Description                                                                                                                                |
| -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `static` | `StaticOutput` | A fixed output produced by every instance. `dataType` is `FromArgs<DataType>` — static, or an args-only lambda for args-derived types.     |
| `list`   | `OutputList`   | A user-managed list of outputs. The UI CRUDs entries directly; each entry contributes one output. Used for Agent's structured outputs.     |

**Shared fields:** `id`, `label`, `type`.

Output parameters are **not** routed through `ParameterEditor`. They are rendered by a dedicated "Outputs" section in `NodeConfigPanel` that dispatches on `output.type`:

- `StaticOutput` → a single binding editor: an `active` checkbox (off = discarded) plus an emit / assign mode toggle
- `OutputList` → a list editor that CRUDs `OutputDeclaration` entries (emit / assign; remove the entry to discard)

### Reference-select parameters

`variable-reference`, `memorySelect`, and `channelSelect` all extend `ReferenceSelectBase` — they select from an external entity list and share common behavior:

- **`default?: never`** — reference targets are user-chosen, not pre-selectable
- **"None" option** always present in the dropdown to allow explicit unset
- **Stale detection** — if the referenced entity is deleted or becomes incompatible, the dropdown shows "Deleted reference" in red as a placeholder (not a selectable option) and the node displays "unknown" in red inline
- **`invalid-reference` diagnostic** — `computeNodeDiagnostics()` flags stale references as errors
- **Shared `ReferenceSelect` component** in ParameterEditor handles the rendering for all three

The `ReferenceSelectParam` union type and `isReferenceSelectParam()` helper are available for code that needs to identify reference-select parameters generically.

| Reference type       | Options source                             | Stored value type        |
| -------------------- | ------------------------------------------ | ------------------------ |
| `variable-reference` | Canvas variables (`useAvailableVariables`) | `Reference \| undefined` |
| `memorySelect`       | Editor store memories (filtered by type)   | `string \| undefined`    |
| `channelSelect`      | Editor store channels (filtered by type)   | `string \| undefined`    |

---

## 2. Defaults

### Input parameter defaults

Input-parameter defaults are **applied once at node creation** (`addNodeToStore()` in `src/workflow-builder/utils/graphOperations.ts`). They are never re-applied — if a user clears a field, the value stays cleared.

**`BoolParam` and `WeekdaysParam` are special:** their `default` fields are required (not optional) because their UI controls (switch toggle, day-of-week multi-toggle) have no visual "unset" state — they always represent a value. Both are always set from creation.

**Reference-select parameters have `default?: never`** — they cannot have defaults because reference targets are user-chosen. The `never` type prevents accidentally setting a default at definition time.

Edge defaults are **not** applied at creation. Edges start with no data; the config panel auto-opens for the user to fill in.

### Output parameter initialization

Output parameters don't have a user-settable `default` field — their initial shape is fixed by the runtime. At node creation, `addNodeToStore()` seeds each output directly into `node.arguments`:

| Output type | Initial value                          | Rationale                                                           |
| ----------- | -------------------------------------- | ------------------------------------------------------------------- |
| `static`    | `{ mode: "emit", name: output.id }`    | Default to emitting a new variable named after the output id        |
| `list`      | `[]` (empty `OutputDeclaration[]`)     | User adds entries via the config panel; empty list is a valid state |

Emit-mode names are deduplicated against existing canvas variables at creation time (`deduplicateEmitNames`), so two nodes with the same default output id don't collide.

---

## 3. Definition → Instance mapping

`NodeDefinition.parameters` (inputs) and `NodeDefinition.outputs` (outputs) together define the schema — what fields exist, their types, defaults, and constraints. `EdgeDefinition.parameters` does the same for edges (edges have no output parameters). The actual values live in `NodeInstance.arguments` (each concrete node type defines a typed `arguments` record) and `EdgeInstance` fields (the `EdgeInstance` interface itself is what ReactFlow stores as `edge.data`), keyed by `parameter.id` / `output.id`.

Since the arguments record is `unknown`-valued, TypeScript cannot enforce what runtime type a given key holds. Instead, each `Parameter.type` / `OutputParameter.type` implies a contract for what type the corresponding value will be at runtime. `ParameterEditor` and the output section of `NodeConfigPanel` uphold this contract on writes; consumers (serialization, diagnostics, code generation) cast accordingly on reads.

### Input parameter runtime types

| Parameter type       | Runtime type                      | Empty state                                    |
| -------------------- | --------------------------------- | ---------------------------------------------- |
| `int` / `float`      | `number \| undefined`             | `undefined` (user clears input)                |
| `string`             | `string`                          | `""` (never `undefined`)                       |
| `bool`               | `boolean`                         | N/A — always set (default is required)         |
| `selection`          | see below                         | depends on `optional` and `default`            |
| `expression`         | `Expression`                      | `{ expression: "", references: [], dataType }` |
| `variable-reference` | `Reference \| undefined`          | `undefined` (no variable selected)             |
| `memorySelect`       | `string \| undefined`             | `undefined` (no memory selected)               |
| `channelSelect`      | `string \| undefined`             | `undefined` (no channel selected)              |
| `time`               | `string \| undefined` (`"HH:MM"`) | `undefined` (no time selected)                 |
| `weekdays`           | `string[]`                        | N/A — always set (default is required)         |

Most input types are nullable because the user may not have interacted yet, or may have cleared the value. The export path validates completeness before proceeding (see section 7).

### Output parameter runtime types

Output parameters store their runtime state in the same `node.arguments` bag, keyed by `output.id`:

| Output type | Runtime type          | Empty state                                                                       |
| ----------- | --------------------- | --------------------------------------------------------------------------------- |
| `static`    | `OutputBinding`       | `{ active: true, mode: "emit", name: output.id }` — set at creation, never unset |
| `list`      | `OutputDeclaration[]` | `[]` — set at creation, user adds entries                                         |

Where:

```typescript
OutputBinding =
  | { active: boolean; mode: "emit"; name: string }       // active=true: create a new variable; active=false: discarded
  | { active: boolean; mode: "assign"; target: Reference } // active=true: write to existing variable; active=false: discarded

OutputDeclaration =
  | { mode: "emit"; uid: string; name: string; dataType: DataType }
  | { mode: "assign"; name: string; dataType: DataType; target: Reference }
```

`OutputBinding.active=false` means the output is discarded (no variable produced or assigned). mode/name/target are kept as draft state while inactive so the row round-trips through an off→on toggle without losing the user's prior choice.

Unlike `OutputBinding`, `OutputDeclaration` carries its own `dataType` as a slot contract — for `assign` entries, staleness against the target is a diagnostic, not a silent retype. List entries have no `active` flag or `discard` mode; removing the entry is how you discard it.

`OutputDeclaration.name` is a single field that does double duty: it's the JSON property name in the LLM's structured response (required for both modes; downstream codegen uses it to build the response schema), and for emit entries it also serves as the new variable's display name in canvas scope. Names must be non-empty and unique within the OutputList parameter — diagnostics flag duplicates because two entries with the same name would silently collide in the LLM's response. The API stores `outputDeclarations` as an ordered list (not a map) — the wire format mirrors the domain shape, no key synthesis on serialize.

`StaticOutput.dataType` is `FromArgs<DataType>` — either a literal type or an args-only lambda. Resolve via `resolveStaticOutputDataType(output, args)` before consuming.

Consumers that need to know "what outputs this node contributes to scope" should not walk `arguments` directly — use `getNodeAvailableOutput(node)` (what the node can produce) or `getNodeOutput(node)` (what actually enters scope after bindings), both in `src/types/node/NodeMethods.ts`. They encapsulate the static-vs-list dispatch and handle the `FunctionCall` exception (see section 6).

### Selection nullability

Selection parameters use a Radix `Select` component which does not allow deselecting — once a value is chosen, it can't be cleared. This means the runtime type depends on whether the parameter has a default and whether it's optional:

| Scenario                 | Runtime type             | Rationale                                                            |
| ------------------------ | ------------------------ | -------------------------------------------------------------------- |
| Required + has `default` | `string` (literal union) | Always set from creation, can't be cleared                           |
| Required + no `default`  | `string \| undefined`    | Starts `undefined`, diagnostic will flag as error until user selects |
| Optional                 | `string \| undefined`    | ParameterEditor adds a "None" option to allow explicit unset         |

Node interfaces should use the narrowest applicable type (e.g. `"digital" | "analog"` for a required selection with default, `"digital" | "analog" | undefined` for one without).

---

## 4. `optional` parameters

`parameter.optional` can be used to declare an input parameter as non-required. The diagnostics system allows unset arguments for these parameters. Active, non-optional parameters are checked for emptiness regardless of whether `default` is defined. A default provides a starting value, not a guarantee — the user can clear it, and the diagnostic will report this as `missing-required-param` error. Parameters hidden by `activationRules` (section 5) are skipped from validation.

Output parameters have no `optional` concept — they are always present on a node. Emit-mode static outputs and `OutputDeclaration` entries may still be flagged by diagnostics for empty names, stale assign targets, etc., but the binding slot itself is never missing.

---

## 5. `activationRules`

Input parameters with `activationRules` are conditionally activated based on sibling values or graph context:

- `{ type: "parameterIn", parameterId, values }` — activate when sibling parameter's value is in the given list (use a single-entry `values` array for the equals case)
- `{ type: "isControlFlow" }` — active only when the node is used in control flow (not as a tool input)
- `{ type: "isToolInput" }` — active only when the node is wired as a tool (e.g. `toolDescription`)

Non-active parameters are not shown in `ParameterEditor`, skipped by required-param validation (section 4), stripped by `serialize()` before export, and marked as not-required in the API schema because they may be absent depending on context.

**Activation rules do not apply to output parameters.** Outputs are always present on a node — the user may rebind them or CRUD list entries, but they cannot be conditionally hidden. If a node's output *type* depends on its configuration, encode that via `FromArgs<DataType>` on `StaticOutput.dataType` rather than trying to hide the output slot.

---

## 6. API schema correspondence

Each domain node has a corresponding schema in `src/api/openapi.yaml`. When creating or updating domain nodes from API changes, the following mappings apply.

### Input fields: API type → Parameter type

| OpenAPI field type                        | Parameter `type`     | Notes                                      |
| ----------------------------------------- | -------------------- | ------------------------------------------ |
| `type: integer`                           | `int`                |                                            |
| `type: number`                            | `float`              |                                            |
| `type: string` (plain)                    | `string`             |                                            |
| `type: string` with `enum`                | `selection`          | Each enum value becomes an `options` entry |
| `type: string` (HH:MM format)             | `time`               | Convention, not enforced by schema         |
| `type: array` of day strings              | `weekdays`           | Convention for day-of-week multi-select    |
| `type: boolean`                           | `bool`               |                                            |
| `$ref: "#/components/schemas/Expression"` | `expression`         | Set `expressionType` from context          |
| `$ref: "#/components/schemas/Reference"`  | `variable-reference` |                                            |
| `$ref: "#/components/schemas/SignalType"` | `selection`          | Shared enum ref, expand to options         |

Note: `memorySelect` and `channelSelect` store a string ID referencing a project-declared Memory (filtered by `memoryType`) or Channel (filtered by `channelType`). Deploy-time bindings on the referenced primitive (e.g. a VectorDatabase's `collectionId`, a Channel's `driverId`) are resolved against the target device at deploy.

### Output fields: API type → Output parameter type

| OpenAPI field shape                                                                     | Output `type` | Notes                                                                                   |
| --------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `$ref: "#/components/schemas/OutputBinding"` (single field)                             | `static`      | Declare on `NodeDefinition.outputs` with a stable `id` matching the API field name      |
| `type: array` of `$ref: "#/components/schemas/OutputDeclaration"` (e.g. Agent's `outputDeclarations`) | `list`        | UI CRUDs entries directly; each entry is already a valid API `OutputDeclaration`        |

`OutputBinding` and `OutputDeclaration` have 1:1 correspondence with their domain types — the API schema shapes match the runtime types in section 3 exactly, so serialization is a passthrough (no coercion).

`FunctionCall` follows the same "output = flat field on args" rule as every other node. Its `NodeDefinition` is built dynamically per-instance by `buildFunctionNodeDef(fn)` from the stored `functionInfo` snapshot — input args become expression parameters, returns become `StaticOutput` entries, and bindings live at `arguments[uid]` like any other node. The snapshot is what allows function calls to have per-instance output shapes without a registered static definition.

### API `required` array → `optional` and `activationRules`

A parameter is **in the API `required` array** if and only if it is **neither `optional` nor has `activationRules`**.

When a field is **not** in the API `required` array, determine the reason:

- **The field is conditionally present** (depends on a sibling value or graph context) → add `activationRules`, do **not** add `optional`. The parameter is still required when its conditions are met — the diagnostic system enforces this.
- **The field is genuinely optional** (user may leave it blank with no conditions) → add `optional: true`, do **not** add `activationRules`.

In other words, `activationRules` and `optional` serve different purposes and must not be conflated. A parameter with `activationRules` is required-when-active; a parameter with `optional` is never required.

Output fields (`OutputBinding` and `OutputDeclaration[]`) should be **in the API `required` array** — they are always initialized at node creation (see section 2) and `activationRules` / `optional` do not apply to outputs.

### Parameter `default`

Defaults are a **definition-only concept** — they exist on `Parameter` definitions and are applied at node creation (see section 2). The API schema should **not** contain `default` values; the backend has no concept of parameter defaults. When adding or updating parameters, set `default` on the Parameter definition based on what makes sense for the UI, not from the API schema.

Output parameters have no `default` field — their initial shape is fixed by the runtime (section 2), not declared per-definition.

For NodeInstance argument types, NodeDefinition structure, port definitions, and files to update when adding/changing a node or edge type, see [domain-structure.md](domain-structure.md).

---

## 7. Serialization

`serialize()` in `src/types/node/NodeSerialization.ts` converts NodeInstance → API format. `deserialize()` does the reverse.

| Path                                   | `undefined` handling                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Auto-save snapshots**                | `JSON.stringify` drops `undefined` naturally; reload treats absent keys as unset                |
| **API export** (code gen, JSON export) | Gated by `validateAllCanvases()` — all required values must exist before export proceeds        |
| **API import**                         | `deserialize()` reads from schema-validated format where required fields are guaranteed present |

**Serialization rules:**

- `serialize()` uses `!` assertions on input fields that are validated as present by the diagnostics gate
- `serialize()` strips input parameters whose `activationRules` are not met — output parameters are never stripped
- `serialize()` resolves `ioSelect` pin references to physical pin numbers via `pinMappings` (provided at export time from the platform binding step)
- `deserialize()` coerces optional API strings to `""` (e.g. `apiNode.arguments.prompt ?? ""`) to match the "string params are never `undefined`" contract
- `OutputBinding` and `OutputDeclaration[]` are passed through verbatim by both paths — their shapes match the API schema 1:1, so no coercion is needed
- `FunctionCall` stores arguments flat in the domain but serializes to a nested `{ inputBindings, outputBindings }` record on the wire — the split is driven by `functionInfo.arguments` vs `functionInfo.returns`, applied at the serialize/deserialize boundary only
