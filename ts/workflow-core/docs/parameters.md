# Parameter Contract

The contract that keeps three layers in agreement:

```
NodeDefinition.parameters   →   NodeData.arguments        →   API schema (contract/workflow.yaml)
  schema: fields, types,        values: an untyped            wire format; the Go consumer
  defaults, flags               Record<string, unknown>       asserts on key PRESENCE
```

`arguments` is `unknown`-valued, so the compiler does **not** check that a `string` param holds a string, or that an always-present field is in the API `required` array. The invariants below are upheld by runtime code (seeding, `serialize`, diagnostics) + by-hand schema authoring — a change in one layer must be mirrored in the other two manually.

Types/logic: `@foresthub/workflow-core` (`src/parameter/`, `src/node/`). Editor inputs: `@foresthub/workflow-builder`.

---

## 1. Presence — the central invariant

One row per Parameter variant (and below the line, per OutputParameter variant), across all three layers. The driving property is **presence**: whether the key is always in `arguments` (and therefore in the API `required` array) or may be absent.

| `type`                    | Variant               | `default`    | runtime type (`arguments`)                            | API field — in `required`?           |
| ------------------------- | --------------------- | ------------ | ----------------------------------------------------- | ------------------------------------ |
| `int` / `float` / `time`  | `BasicParam`          | `default?`   | `number \| undefined` (`time`: `string \| undefined`) | `integer` / `number` / `string` — No |
| `string`                  | `StringParam`         | `default?`   | `string` (`""` when empty → prunes to absent)         | `string` — No                        |
| `selection`               | `SelectionParam`      | `default?`   | `string \| undefined`                                 | `enum` (base type varies) — ‡        |
| `bool`                    | `BoolParam`           | **required** | `boolean`                                             | `boolean` — **Yes**                  |
| `weekdays`                | `WeekdaysParam`       | **required** | `string[]`                                            | `array<string>` — **Yes**            |
| `memory-refs`             | `MemoryRefsParam`     | **required** | `MemoryRef[]`                                         | `array<MemoryRef>` — **Yes**         |
| `expression`              | `ExpressionParam`     | **required** | `Expression` (value object, never bare unset)         | `$ref Expression` — **Yes**          |
| `variableSelect`          | `VariableSelectParam` | `never`      | `Reference \| undefined`                              | `$ref Reference` — No                |
| `memorySelect`            | `MemorySelectParam`   | `never`      | `string \| undefined`                                 | `string` (memory id) — No            |
| `channelSelect`           | `ChannelSelectParam`  | `never`      | `string \| undefined`                                 | `string` (channel id) — No           |
| `modelSelect`             | `ModelSelectParam`    | `never`      | `string \| undefined`                                 | `string` (model id) — No             |
| **— output parameters —** |                       |              |                                                       |                                      |
| `static`                  | `StaticOutput`        | seeded       | `OutputBinding`                                       | `$ref OutputBinding` — **Yes**       |
| `list`                    | `OutputList`          | seeded       | `OutputDeclaration[]`                                 | `array<OutputDeclaration>` — **Yes** |

**Overrides:** `optional: true` **or** any `activationRules` ⇒ **not** in `required` — the key may be absent (genuinely optional, or conditionally present). These are instance flags; the `required?` mark above is the baseline when neither is set. `selection` / `string` enum values become `options`; `string`-id selects are filtered by `memoryType` / `channelType` / `modelType`.

‡ `selection`: a non-optional Radix select has **no clear affordance** (the "None" item is rendered only when `optional`), so non-optional + `default` ⇒ can't be emptied ⇒ always present ⇒ required. Otherwise `string | undefined`. (`string` differs: a text input is always clearable, so an empty `""` always prunes to absent — never required.)

"In API `required`" tracks the **key**, never the value. An always-present field may still hold an empty value (empty expression, unnamed binding, `[]`); that's a `missing-required-param` diagnostic, not an absent key — which is why marking it `required` never blocks saving in-progress work. Output params have no `optional` / `activationRules` — always present.

---

## 2. "Unset" and the list invariant

No single representation of unset: a value may be **absent**, **`undefined`** (cleared scalar, or `deserialize` of an absent API key), or **`""`** (cleared text input). `isEmpty` is the one definition, shared by diagnostics and `pruneArguments`:

```ts
isEmpty(value) === (value === undefined || value === null || value === "");
```

Not empty: `false`, `0` (valid values), and **`[]`**. The **list invariant** is why `[]` is excluded: `weekdays`, `memory-refs`, and list outputs are **always a concrete array** (required `default`, seeded at creation, serializer `?? []`), so a list never needs an unset sentinel and an empty list is valid even when non-optional.

---

## 3. `optional` vs `activationRules`

Two flags let a key be legitimately missing. They're mutually exclusive intents — set at most one.

**`optional: true`** — "an empty value is acceptable". Diagnostics skip the required-emptiness check, and the key is dropped from API `required`. Use it for **scalars** (string, number, selects), where an empty value _is_ an absent key — empties are pruned at serialize (§4).

**`activationRules`** — the param exists only when all rules hold (AND). Inactive params are skipped by diagnostics, pruned at serialize (§4), and are **never** in API `required` — conditionally present, but still required _when active_ (enforced by diagnostics). This is "required when active"; `optional` is "never required".

**Lists use neither flag.** A list that's "always present, may be empty" (`weekdays`, `memory-refs`, list outputs) needs no flag: give it `default: []` and leave it **non-optional**. `isEmpty([])` is `false` (§2), so an empty list is never flagged and stays in API `required`. Marking it `optional` would wrongly drop it from `required` — don't.

---

## 4. Serialize boundary & API `required`

**The domain store is a SUPERSET.** Inactive and empty values are _retained_ in the store (so switching a channel's `type` away and back restores prior values). Normalization happens **only at serialize**, never on store-writes.

`pruneArguments(args, parameters, isToolInput)` (`Parameter.ts`) is the shared boundary normalizer (node + channel `serialize`). It mutates `args`, deleting any arg that is **inactive** or **`isEmpty`**:

```ts
if ((param.activationRules?.length && !isParameterActive(param, args, isToolInput)) || isEmpty(args[param.id]))
  delete args[param.id];
```

Why prune emptiness here: **`JSON.stringify` only omits `undefined`** object properties — `""`, `null`, `[]` survive as real JSON. The consumer keys off presence, so an unset value must be _absent_, not `""`/`null`. `pruneArguments` guarantees that; JSON alone would leak. `[]` is intentionally kept (real value).

Export is **not** gated by validation — `pruneArguments` drops empties unconditionally, so a _required_ field left empty is dropped and the consumer rejects the result. That is acceptable: an invalid workflow produces an invalid export.

**API `required` rule:** a field is in the schema's `required` array **iff its key is always present** (§1) and it is neither `optional` nor activation-gated. Mirror the §1 table when authoring `contract/workflow.yaml`; regenerate with `npm run generate`.

`deserialize` reads `required` fields directly (no fallback) and coerces genuinely-optional ones at the boundary (`string ?? ""`, list `?? []`) to uphold "strings/lists are never `undefined`". `OutputBinding`/`OutputDeclaration[]` are cast (not coerced) from the looser API shape.

`FunctionCall` is excluded from `pruneArguments` — it stores args flat in the domain but serializes to nested `{ inputBindings, outputBindings }`, gating its own params inline.

Defaults are **definition-only**, applied once at node creation (deep-cloned). The API schema carries **no** defaults — the backend has no concept of them.
