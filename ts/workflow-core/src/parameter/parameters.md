# Parameter Type System

Nodes and edges in the workflow builder are configured through parameters — typed fields that appear in the config panel when a node or edge is selected. Both use the same input-parameter type system, so the editing experience, validation, and serialization logic is shared.

Nodes additionally declare **output parameters** — typed slots for what the node produces into variable scope. Output parameters live alongside input parameters on `NodeDefinition` (in a separate `outputs` array) and store their runtime state in the same `node.arguments` bag, but they use their own variant types and are rendered through a dedicated output section of the config panel.

The headless types and logic in this table live in `@foresthub/workflow-core` (`ts/workflow-core/src/parameter/`); the editor inputs that render them live in `@foresthub/workflow-builder`.

---

## 1. Type structure

### Input parameters (`ts/workflow-core/src/parameter/Parameter.ts`)

`Parameter = ParameterBase & Variant`. The `type` discriminator selects the variant:

| `type`                 | Variant               | Extra fields                                        | `default`            |
| ---------------------- | --------------------- | --------------------------------------------------- | -------------------- |
| `int`, `float`, `time` | `BasicParam`          | —                                                   | `default?`           |
| `string`               | `StringParam`         | `multiline?`                                        | `default?`           |
| `bool`                 | `BoolParam`           | —                                                   | `default` (required) |
| `weekdays`             | `WeekdaysParam`       | —                                                   | `default` (required) |
| `selection`            | `SelectionParam`      | `options: {value, label}[]`                         | `default?`           |
| `expression`           | `ExpressionParam`     | `expressionType`, `fromReference?`                  | `default` (required) |
| `variableSelect`       | `VariableSelectParam` | —                                                   | `never`              |
| `memorySelect`         | `MemorySelectParam`   | `memoryType`                                        | `never`              |
| `channelSelect`        | `ChannelSelectParam`  | `channelType`                                       | `never`              |
| `modelSelect`          | `ModelSelectParam`    | `modelType`, `capabilities?`                        | `never`              |
| `memory-refs`          | `MemoryRefsParam`     | —                                                   | `never`              |

**`ParameterBase` fields:** `id`, `label`, `description`, `optional?`, `activationRules?`. `default` is not on the base — each variant declares its own (or forbids it via `never`).

`ParameterEditor` (`ts/workflow-builder/src/inputs/ParameterEditor.tsx`) has an exhaustive `switch` on `parameter.type` — adding a new input variant without a corresponding `case` is a compile error.

`ExpressionParam.fromReference` is an escape hatch for the variableSelect case: when set, it points to the id of a sibling `variableSelect` parameter, and the expression's expected type is taken from whatever variable that sibling currently references (falling back to the declared `expressionType`).

### Output parameters (`ts/workflow-core/src/parameter/Output.ts`)

`OutputParameter = StaticOutput | OutputList`. Output parameters are declared on `NodeDefinition.outputs` (separate from `parameters`) and describe what the node produces into variable scope.

| `type`   | Variant        | Description                                                                                                                            |
| -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `static` | `StaticOutput` | A fixed output produced by every instance. `dataType` is `FromArgs<DataType>` — static, or an args-only lambda for args-derived types. |
| `list`   | `OutputList`   | A user-managed list of outputs. The UI CRUDs entries directly; each entry contributes one output. Used for Agent's structured outputs. |

**Shared fields:** `id`, `label`, `type`.

Output parameters are **not** routed through `ParameterEditor`. They are rendered by a dedicated "Outputs" section in `NodeConfigPanel` that dispatches on `output.type`:

- `StaticOutput` → a single binding editor: an `active` checkbox (off = discarded) plus an emit / assign mode toggle
- `OutputList` → a list editor that CRUDs `OutputDeclaration` entries (emit / assign; remove the entry to discard)

### Reference-select parameters

`variableSelect`, `memorySelect`, `channelSelect`, and `modelSelect` select an external entity by id and share common behavior. They are unioned as `ReferenceSelectParam`, with the `isReferenceSelectParam()` type guard for code that needs to identify them generically. Each declares `default?: never` — reference targets are user-chosen, never pre-selectable.

- **"None" option** always present in the dropdown to allow explicit unset
- **Stale detection** — if the referenced entity is deleted or becomes incompatible, the dropdown shows "Deleted reference" in red as a placeholder (not a selectable option) and the node displays "unknown" in red inline
- **`invalid-reference` diagnostic** — `computeNodeDiagnostics()` flags stale or type-incompatible references as errors

| Reference type   | Options source                                       | Stored value type        |
| ---------------- | ---------------------------------------------------- | ------------------------ |
| `variableSelect` | Canvas variables (`useAvailableVariables`)           | `Reference \| undefined` |
| `memorySelect`   | Declared memories, filtered by `memoryType`          | `string \| undefined`    |
| `channelSelect`  | Declared channels, filtered by `channelType`         | `string \| undefined`    |
| `modelSelect`    | Static model catalog ∪ declared custom models        | `string \| undefined`    |

`modelSelect` resolves a model id against the static catalog (passed to the editor as props) unioned with declared custom models, filtered by `modelType` and an optional `capabilities` list.

---

## 2. Defaults

### Input parameter defaults

Input-parameter defaults are **applied once at node creation** (`addNodeToStore()` in `ts/workflow-builder/src/utils/graphOperations.ts`). They are never re-applied — if a user clears a field, the value stays cleared. Defaults are **deep-cloned** (`structuredClone`) when seeded, so object/array defaults (`Expression`, `weekdays: []`) are never shared by reference across instances or with the definition itself.

**`BoolParam`, `WeekdaysParam`, and `ExpressionParam` have required `default` fields** because their values always exist — there is no "unset" state for them:

- `bool` (switch toggle) and `weekdays` (day-of-week multi-toggle) always represent a value.
- An `expression` is always a value object; "empty" is `{ expression: "", references: [], dataType }`, not absent. The required default seeds this at creation (carrying the slot's initial dataType), so the key is always present. Diagnostics still flag the empty value as `missing-required-param`.

**Reference-select parameters have `default?: never`** — they cannot have defaults because reference targets are user-chosen. The `never` type prevents accidentally setting one at definition time.

Edge defaults are **not** applied at creation. Edges start with no data; the config panel auto-opens for the user to fill in. (Edge `expression` params still declare a required `default`, but it is unused at creation since edges aren't seeded — the serializer supplies an empty expression as a fallback.)

### Output parameter initialization

Output parameters don't have a user-settable `default` field — their initial shape is fixed by the runtime. At node creation, `addNodeToStore()` seeds each output directly into `node.arguments`:

| Output type | Initial value                              | Rationale                                                           |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------- |
| `static`    | `{ active: true, mode: "emit", name: id }` | Default to emitting a new variable named after the output id        |
| `list`      | `[]` (empty `OutputDeclaration[]`)         | User adds entries via the config panel; empty list is a valid state |

Emit-mode names are deduplicated against existing canvas variables at creation time (`deduplicateEmitNames`), so two nodes with the same default output id don't collide.

---

## 3. Definition → Instance mapping

`NodeDefinition.parameters` (inputs) and `NodeDefinition.outputs` (outputs) together define the schema — what fields exist, their types, defaults, and constraints. `EdgeDefinition.parameters` does the same for edges (edges have no output parameters). The actual values live in `NodeInstance.arguments` (each concrete node type defines a typed `arguments` record) and `EdgeInstance` fields (the `EdgeInstance` interface itself is what React Flow stores as `edge.data`), keyed by `parameter.id` / `output.id`.

Since the arguments record is `unknown`-valued, TypeScript cannot enforce what runtime type a given key holds. Instead, each `Parameter.type` / `OutputParameter.type` implies a contract for what type the corresponding value will be at runtime. `ParameterEditor` and the output section of `NodeConfigPanel` uphold this contract on writes; consumers (serialization, diagnostics, code generation) cast accordingly on reads.

### Input parameter runtime types

| Parameter type   | Runtime type                      | Empty / unset state                            |
| ---------------- | --------------------------------- | ---------------------------------------------- |
| `int` / `float`  | `number \| undefined`             | `undefined` (user clears input)                |
| `string`         | `string`                          | `""` (coerced; absent until typed)             |
| `bool`           | `boolean`                         | N/A — always set (default required)            |
| `weekdays`       | `string[]`                        | N/A — always set (default required); may be `[]` |
| `selection`      | see [§3 nullability](#selection-nullability) | depends on `optional` and `default`  |
| `expression`     | `Expression`                      | `{ expression: "", references: [], dataType }` — seeded at creation |
| `time`           | `string \| undefined` (`"HH:MM"`) | `undefined` (no time selected)                 |
| `variableSelect` | `Reference \| undefined`          | `undefined` (no variable selected)             |
| `memorySelect`   | `string \| undefined`             | `undefined` (no memory selected)               |
| `channelSelect`  | `string \| undefined`             | `undefined` (no channel selected)              |
| `modelSelect`    | `string \| undefined`             | `undefined` (no model selected)                |
| `memory-refs`    | `MemoryRef[]`                     | `[]` / `undefined` (serializer coerces to `[]`) |

The clearable types (`int`/`float`/`time`, references) can become `undefined`; `bool`/`weekdays`/`expression` always carry a value. The export path validates completeness before proceeding (see [§7](#7-serialization)).

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

`OutputDeclaration.name` does double duty: it's the JSON property name in the LLM's structured response (required for both modes; downstream codegen uses it to build the response schema), and for emit entries it also serves as the new variable's display name in canvas scope. Names must be non-empty and unique within the OutputList parameter — diagnostics flag duplicates because two entries with the same name would silently collide in the LLM's response. The API stores `outputDeclarations` as an ordered list (not a map) — the wire format mirrors the domain shape, no key synthesis on serialize.

`StaticOutput.dataType` is `FromArgs<DataType>` — either a literal type or an args-only lambda. Resolve via `resolveStaticOutputDataType(output, args)` before consuming.

Consumers that need to know "what outputs this node contributes to scope" should not walk `arguments` directly — use `getNodeAvailableOutput(node)` (what the node can produce) or `getNodeOutput(node)` (what actually enters scope after bindings), both in `ts/workflow-core/src/node/methods.ts`. They encapsulate the static-vs-list dispatch and handle the `FunctionCall` exception (see [§6](#functioncall)).

### Selection nullability

Selection parameters use a Radix `Select` component which does not allow deselecting — once a value is chosen, it can't be cleared. So the runtime type depends on whether the parameter has a default and whether it's optional:

| Scenario                 | Runtime type             | Rationale                                                            |
| ------------------------ | ------------------------ | -------------------------------------------------------------------- |
| Required + has `default` | `string` (literal union) | Always set from creation, can't be cleared                           |
| Required + no `default`  | `string \| undefined`    | Starts `undefined`, diagnostic will flag as error until user selects |
| Optional                 | `string \| undefined`    | ParameterEditor adds a "None" option to allow explicit unset         |

Node interfaces should use the narrowest applicable type (e.g. `"digital" | "analog"` for a required selection with default, `"digital" | "analog" | undefined` for one without).

---

## 4. `optional` parameters

`parameter.optional` declares an input parameter as non-required. The diagnostics system allows unset arguments for these. Active, non-optional parameters are checked for emptiness regardless of whether `default` is defined — a default provides a starting value, not a guarantee, since the user can clear it (the diagnostic then reports `missing-required-param`). Parameters hidden by `activationRules` ([§5](#5-activationrules)) are skipped from validation.

Output parameters have no `optional` concept — they are always present on a node. Emit-mode static outputs and `OutputDeclaration` entries may still be flagged by diagnostics for empty names, stale assign targets, etc., but the binding slot itself is never missing.

---

## 5. `activationRules`

Input parameters with `activationRules` are conditionally activated based on sibling values or graph context:

- `{ type: "parameterIn", parameterId, values }` — activate when sibling parameter's value is in the given list (use a single-entry `values` array for the equals case)
- `{ type: "isControlFlow" }` — active only when the node is used in control flow (not as a tool input)
- `{ type: "isToolInput" }` — active only when the node is wired as a tool (e.g. `toolDescription`)

Non-active parameters are not shown in `ParameterEditor`, skipped by required-param validation ([§4](#4-optional-parameters)), stripped by `serialize()` before export, and not in the API `required` array (they may be absent depending on context).

**Activation rules do not apply to output parameters.** Outputs are always present on a node — the user may rebind them or CRUD list entries, but they cannot be conditionally hidden. If a node's output *type* depends on its configuration, encode that via `FromArgs<DataType>` on `StaticOutput.dataType` rather than hiding the output slot.

---

## 6. API schema correspondence

Each domain node has a corresponding schema in `contract/workflow.yaml`; `npm run generate` (in `ts/workflow-core`) regenerates `src/api/workflow.ts` from it. When creating or updating domain nodes from API changes, the following mappings apply.

### Input fields: API type → Parameter type

| OpenAPI field type                        | Parameter `type` | Notes                                      |
| ----------------------------------------- | ---------------- | ------------------------------------------ |
| `type: integer`                           | `int`            |                                            |
| `type: number`                            | `float`          |                                            |
| `type: string` (plain)                    | `string`         |                                            |
| `type: string` with `enum`                | `selection`      | Each enum value becomes an `options` entry |
| `type: string` (HH:MM format)             | `time`           | Convention, not enforced by schema         |
| `type: array` of day strings              | `weekdays`       | Convention for day-of-week multi-select    |
| `type: boolean`                           | `bool`           |                                            |
| `$ref: ".../Expression"`                  | `expression`     | Set `expressionType` from context          |
| `$ref: ".../Reference"`                   | `variableSelect` |                                            |
| `$ref: ".../SignalType"`                  | `selection`      | Shared enum ref, expand to options         |

`memorySelect` / `channelSelect` / `modelSelect` store a string id referencing a project-declared Memory / Channel / Model (or a static-catalog model id), filtered by `memoryType` / `channelType` / `modelType`. Deploy-time bindings on the referenced primitive (a VectorDatabase's `collectionId`, a Channel's `driverId`, a Model's `providerBinding`) are resolved against the target device at deploy.

### Output fields: API type → Output parameter type

| OpenAPI field shape                                                              | Output `type` | Notes                                                                              |
| -------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `$ref: ".../OutputBinding"` (single field)                                       | `static`      | Declare on `NodeDefinition.outputs` with a stable `id` matching the API field name |
| `type: array` of `$ref: ".../OutputDeclaration"` (e.g. Agent's `outputDeclarations`) | `list`    | UI CRUDs entries directly; each entry is already a valid API `OutputDeclaration`   |

`OutputBinding` and `OutputDeclaration` correspond 1:1 with their domain types in the api, but the api schemas are looser (a single object with optional `name`/`target`, vs. the domain's discriminated union), so `deserialize()` casts them to the domain shape. There's no value coercion.

<a id="functioncall"></a>`FunctionCall` follows the same "output = flat field on args" rule as every other node. Its `NodeDefinition` is built dynamically per-instance by `buildFunctionNodeDef(fn)` from the stored `functionInfo` snapshot — input args become `expression` parameters (each with a seeded empty-expression `default`), returns become `StaticOutput` entries, and bindings live at `arguments[uid]` like any other node. In the api, FunctionCall keeps a nested `{ inputBindings, outputBindings }` shape; the flat↔nested split happens only at the serialize/deserialize boundary.

### When is a field in the API `required` array?

The governing question is **whether the field's key is always present in well-formed editor output**, which is a function of the parameter type *and* its flags — not just `optional`/`activationRules`. There are three axes:

1. **`activationRules`** → **not** in `required`. The field is conditionally present (depends on a sibling value or graph context). It's still required *when active* — the diagnostic system enforces that. Do not also add `optional`.
2. **`optional: true`** → **not** in `required`. The field is genuinely optional with no conditions.
3. Otherwise, **required iff the type guarantees the key is always present**:

| Always present → **`required`**                                  | Key can be absent → **optional**                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| Output fields (`OutputBinding`, `OutputDeclaration[]`)           | Clearable scalars: `int`, `float`, `time`                         |
| `expression` (required `default`, seeded at creation)            | `string` without a default (absent until typed)                   |
| `bool`, `weekdays` (required `default`, no unset control state)  | Reference-selects: `variableSelect` / `memorySelect` / `channelSelect` / `modelSelect` |
| `selection` that is non-optional **and** has a `default`         | `memory-refs`                                                     |

> Why this is safe for "save incomplete states": marking an always-present field `required` does **not** block saving an in-progress workflow. For these types the *key* is always present (seeded at creation / no unset affordance) — incompleteness lives in the *value* (an empty expression, an empty binding name, an unselected selection), which diagnostics flag as `missing-required-param`. A field needs to be optional only when its *key* can genuinely be absent, which is exactly the clearable/None types above.

> Historical note: an earlier rule ("required iff neither `optional` nor `activationRules`") ignored axis 3 and wrongly marked clearable types required, so the api schema was over-loosened to make *every* argument optional. The rule above is the corrected version — tighten the always-present set, leave the clearable set optional.

`deserialize()` reads schema-validated input, so it reads `required` fields straight off `arguments` with no fallback. Optional fields are coerced at the boundary (strings → `""`, numbers left `undefined`) so the editor renders an empty field instead of throwing.

### Parameter `default`

Defaults are a **definition-only concept** — they exist on `Parameter` definitions and are applied at node creation ([§2](#2-defaults)). The API schema should **not** contain `default` values; the backend has no concept of parameter defaults. Set `default` on the Parameter definition based on what makes sense for the UI, not from the API schema.

Output parameters have no `default` field — their initial shape is fixed by the runtime ([§2](#2-defaults)), not declared per-definition.

---

## 7. Serialization

`serialize()` in `ts/workflow-core/src/node/serialization.ts` converts NodeInstance → API format; `deserialize()` does the reverse.

| Path                                   | `undefined` handling                                                                            |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Auto-save snapshots**                | `JSON.stringify` drops `undefined` naturally; reload treats absent keys as unset                |
| **API export** (code gen, JSON export) | Gated by full-project validation — all required values must exist before export proceeds         |
| **API import**                         | `deserialize()` reads from schema-validated format where `required` fields are guaranteed present |

**Serialization rules:**

- `serialize()` uses `!` assertions on input fields validated as present by the diagnostics gate.
- `serialize()` emits every field uniformly, then a single post-pass strips activation-gated params (e.g. `toolDescription`) that are inactive for this instance or active-but-unset. This post-pass is the single source of truth for activation-gated presence; per-node cases don't gate them inline. `FunctionCall` is excluded (it gates its own params, having a different api shape).
- `deserialize()` reads `required` fields directly (no sentinel default), and coerces only genuinely-optional fields (e.g. `apiNode.arguments.prompt ?? ""` for optional strings) to satisfy the "string params are never `undefined`" contract.
- `OutputBinding` / `OutputDeclaration[]` are cast (not coerced) from the looser api shape to the domain union; their values pass through verbatim.
- `FunctionCall` stores arguments flat in the domain but serializes to a nested `{ inputBindings, outputBindings }` record in the api — the split is driven by `functionInfo.arguments` vs `functionInfo.returns`, applied at the serialize/deserialize boundary only.
