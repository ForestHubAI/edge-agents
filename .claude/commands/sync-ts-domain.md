# Sync TS Domain Layer with API Contract

Synchronize the **TypeScript** side — `workflow-core` domain layer (and any
`workflow-builder` knock-on edits) — with the current `contract/workflow.yaml`.
The Go engine side has its own sync command; this one does not touch `go/`. Use this **after** the contract
YAML has been edited (or pulled in from `fh-backend`) to add/remove/change
nodes, channels, memory types, model types, or their argument shapes.

The repo invariant: `contract/` is the source of truth, generated api is its
TypeScript mirror, and the hand-written domain + serializers must be reconciled
by hand. This command does that reconciliation.

## Step 0 — Regenerate the api layer

From `ts/`:

```
npm run generate
```

Regenerates the api layer from `contract/` — for node sync the file that matters
is `ts/workflow-core/src/api/workflow.ts` (from `contract/workflow.yaml`); the same
script also emits `deployment.ts` and `engine.ts` from the other specs. Never
hand-edit those files. If `git status` shows `workflow.ts` dirty after this step,
that diff IS the spec change to react to in the next steps.

## Step 1 — Internalise the layering before you touch anything

Read these *before* diffing. They are the canon — if anything below
contradicts them, they win.

- `ts/CLAUDE.md` — package boundary and the three-way parameter contract.
- `ts/workflow-core/docs/architecture.md` — domain ⇄ api, `Api`-prefix naming,
  why `NodeData`/`EdgeData` exist, where serialize/deserialize live.
- `ts/workflow-core/docs/parameters.md` — **the load-bearing one.** Presence
  table (§1), the list invariant (§2), `optional` vs `activationRules` (§3),
  and the serialize boundary + `pruneArguments` (§4). The api `type` → domain
  `arguments` type and the api `type` → `Parameter` variant mappings come
  straight out of §1.

The three layers you are reconciling:

```
NodeDefinition.parameters   →   NodeData.arguments        →   api schema
  (static schema, defaults,     (untyped Record, holds         (workflow.yaml,
   activationRules, flags)       inactive + empty values)        `required` tracks
                                                                 KEY presence)
```

Compiler does not enforce alignment between them. You do.

## Step 2 — Diff each surface vs the api

The contract has four domain-mirrored surfaces. Diff each.

### 2a. Nodes (`src/node/`)

Compare `Schemas["Node"]` (discriminated on `type`) against:

- per-variant interfaces in `src/node/{Input,Output,Trigger,Tool,Logic,Data,Agent,Mqtt,Function}Node.ts`
- the `NodeDefinition` constants in the same files
- registration in `src/node/NodeRegistry.ts`
- the `switch` arms in `src/node/serialization.ts` (`serializeNodeData` + `deserializeNodeData`)
- the `switch` arms in `src/node/methods.ts` (`getPorts`, `getInput`)

Look for:

- **New `type` values** in the api union with no domain interface → add.
- **Removed `type` values** still in the domain → delete.
- For each surviving type, diff `arguments.properties`, `arguments.required`,
  `default`, `enum`, `$ref`:
  - **Added field** → add to interface, `NodeDefinition.parameters`, both serialize arms.
  - **Removed field** → strip from all four.
  - **Type change** (`integer`↔`number`, new/removed enum members, `$ref`
    swapped) → update interface type, `Parameter` variant, and both serialize arms.
  - **Required change** (in/out of `arguments.required`) → §1 of parameters.md
    governs the mapping. Toggling `required` ↔ optional usually means flipping
    `optional: true` on the `Parameter` and adjusting nullability + the
    `deserialize` fallback (`?? ""`, `?? 0`, etc).
  - **Default added/removed/changed** → mirror on the `Parameter`'s `default`
    (definition-only — the api carries no defaults).

### 2b. Channels (`src/channel/`)

**Different shape from nodes.** There is one `CHANNEL_DEFINITION` whose `type`
is itself a `selection` parameter, with the per-variant fields gated by
`activationRules: [{ type: "parameterIn", parameterId: "type", values: [...] }]`.
See `src/channel/ChannelDefinition.ts` for the rationale (preserves shared
arg state across in-place type switches).

Diff `Schemas["Channel"]` (a oneOf over `*Channel` variants) against:

- the `selection` options in `CHANNEL_DEFINITION` (must mirror `ALL_CHANNEL_TYPES`)
- gated parameters in `CHANNEL_DEFINITION.parameters`
- both arms of `src/channel/serialization.ts`
- `ChannelType` and `ALL_CHANNEL_TYPES` in `src/channel/Channel.ts`

For a new channel type: add it to `ChannelType` / `ALL_CHANNEL_TYPES`, add any
gated params with `parameterIn` activation rules, add `case` arms in both
serializers. Deploy-time bindings (`driverId` / `networkId`) are emitted as `""`
by `serialize` and dropped by `deserialize` — keep that pattern.

### 2c. Memory types (`src/memory/`) and Model types (`src/model/`)

These use the **per-type registry** pattern (like nodes, unlike channels):
`<Type>Definition` constants + a `Registry.initialize()` call site. Diff:

- `Schemas["Memory"]` / `Schemas["Model"]` discriminator vs `MemoryType` / `ModelType` unions and `ALL_*_TYPES` arrays.
- `arguments` properties of each variant vs the corresponding `*Definition.parameters`.
- `MemoryRegistry` / `ModelRegistry` registrations.
- `src/{memory,model}/serialization.ts` arms.

For Model, also check `Schemas["ModelCapability"]` — it's re-exported as a
domain type alias from the api (bare name, no `Api` prefix; see architecture.md
on api-only types).

### 2d. Cross-cutting api types

If the contract added/changed a shared `$ref` (e.g. `Expression`, `Reference`,
`OutputBinding`, `OutputDeclaration`, `MemoryRef`), grep for its usages across
the four domain modules above — and inside `src/expression/`, `src/variable/`,
`src/parameter/` — and reconcile each touch point. These are the leaves the
node/channel/memory/model arguments rest on; a shape change ripples.

## Step 3 — Apply the changes

Order matters. For each new node type:

1. **`src/node/<Category>Node.ts`** — add the `interface … extends NodeBase`
   with a typed `arguments` shape (use the api→domain map from parameters.md §1),
   extend the category's `*NodeType` and `*Node` unions, and add a
   `NodeDefinition` constant.
   - Required+default scalar → non-nullable, definition gets a `default`.
   - Required no-default scalar → `T | undefined` in the interface, no `default`,
     `deserialize` coerces (`?? ""`, `?? 0`).
   - Optional scalar (`optional: true`) → `T | undefined`, no default, pruned at serialize.
   - Lists → **always concrete array**, never optional, give the `Parameter` a
     `default: []`. Empty list is valid (§2 list invariant).
   - Map api `Parameter` types per parameters.md §1 (the presence table).
2. **`src/node/NodeRegistry.ts`** — import the new `NodeDefinition`, register it
   in `initialize()`.
3. **`src/node/methods.ts`** — add the new `type` to `getPorts()` (trigger →
   no input; tool-only → tool-input only; tool-capable → ctrl + tool input;
   plain → ctrl in/out). Add to `getInput()` only if it consumes external
   hardware I/O in debug mode.
4. **`src/node/serialization.ts`** — add both a `serializeNodeData` case
   (domain → api, `!`-assert validated fields, only emit `optional` keys with
   `... !== undefined ? { … } : {}` when the api required-list excludes them)
   and a `deserializeNodeData` case (coerce `?? ""` / `?? 0` / `?? []` at the
   boundary to uphold "strings/lists are never `undefined`"; cast looser api
   `OutputBinding` / `OutputDeclaration[]` shapes to the strict domain types).

For a modified node, hit only the touched fields across (1), (3) if ports
changed, and (4). For a removed node, delete from all four files (and from the
category union); the exhaustive `switch` will refuse to compile until clean.

Channel / Memory / Model edits follow the same pattern — see step 2 for which
files each surface lives in.

### `workflow-builder` knock-on

`workflow-core` is the boundary; the builder normally re-renders from
`NodeRegistry` / `MemoryRegistry` / `ModelRegistry` without code edits. Only
touch the builder if:

- `src/utils/connectionRules.ts` hard-codes a node-type-specific rule.
- A panel under `src/panels/` references a specific node/channel/memory/model
  type by string literal (`ChannelConfigPanel`, `ModelConfigPanel`, etc).
- An i18n key needs to be added for a new description — that's the
  `sync-translations` command's job, run it after this one.

Do **not** touch React Flow node components for the canvas — they read off
`NodeDefinition` and don't care which types exist.

## Step 4 — Verify

From `ts/`:

```
npm run typecheck
npm run lint
npm run test
```

The exhaustive `switch` statements in `serialization.ts` and `methods.ts` will
catch any missing arm. `noUncheckedIndexedAccess` will surface places where you
forgot a `??` fallback in `deserialize`. Fix until clean.

If `contract/workflow.yaml` was edited (not just consumed), also run the Go side
from repo root: `cd go && go generate ./... && go build ./...`. Otherwise the
two languages silently drift — exactly the failure mode the contract exists to
prevent.

## Step 5 — Report

```
## Sync Results

### Nodes
- Added `FooNode` (Input) — interface, definition, registry, ports, serialize
- Modified `AgentNode.arguments.maxTurns`: integer → optional integer
- Removed `BarNode`

### Channels
- Added `SPI` variant — `ALL_CHANNEL_TYPES`, gated params, both serializers

### Memory / Models
- (changes or "no changes")

### Cross-cutting
- `Expression.dataType` added new enum member `bytes` — reconciled in
  `src/expression/…`

### Verification
- typecheck ✅  lint ✅  test ✅
```

Flag anything left to the user — e.g. a removed enum value still referenced by
a saved workflow fixture, or an i18n description key that needs a translation
pass via `/sync-translations`.
