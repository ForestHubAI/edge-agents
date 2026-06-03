# Functions

A function is a reusable subgraph with a typed signature: callers invoke it from any
canvas, it runs its own body to idle, then returns named values. This doc is the
programmer's map of the types involved and the one hard problem they exist to solve —
**a call site referencing a signature that can change underneath it.**

## The split: declaration vs. body

A function is two things joined by an `id`:

- **Declaration** — the signature (name, argument ports, return ports) plus the
  *return-value expressions* (what each output evaluates to, in callee scope). This is
  project-scoped state, owned by `workflow-builder`'s `editorStore.functions` as a
  `FunctionDeclaration`. It is **not** undo-tracked (see migration, below).
- **Body** — a canvas of nodes/edges/variables with its own undo history, owned by the
  function's `canvasStore` keyed by the same `id`.

Serialization reassembles them into one wire `Function`; nothing else couples them.

## Runtime model (the engine)

The engine resolves a `FunctionCall` purely by **`functionId`**, looks the function up
in the workflow's function table, runs its body to idle, then evaluates a flat
`map[returnUid → Expression]` in callee scope and returns. A return with no assignment
is a hard error. There is no return *node* and nothing fires on `OnFunctionCall` exit —
the return expression belongs *with* the return declaration, which is why the
declaration (not the body) owns the output expressions.

The wire therefore carries only the reference. Everything below about snapshots and
staleness is **editor-side state**, reconstructed on load — the engine never sees it.

## The three types

### `FunctionInfo` — the flat signature (api + domain snapshot)

```ts
{ id, version, name, arguments: Variable[], returns: Variable[] }   // no expressions
```

The contract type (`Schemas["FunctionInfo"]`), so Go and TS share it for free. It is a
*signature*: identity (`id`), a drift stamp (`version`), and the two port lists — and
nothing about how the outputs are computed. It appears in exactly two roles:

1. On the wire, inside each `Function` entry.
2. In the domain, as the **snapshot a `FunctionCallNode` caches** (see staleness).

It is never used to *represent* a function while editing — that's `FunctionDeclaration`.

### `FunctionDeclaration` — the domain truth

```ts
{ id, version, name, arguments: ApiVariable[], outputs: OutputAssignment[] }
// OutputAssignment = { uid, name, dataType, expression }
```

The editable declaration. It differs from `FunctionInfo` in one way that matters: each
output **bundles its declaration with the expression that produces it** (`outputs`),
where `FunctionInfo.returns` is bare port declarations. `toFunctionInfo(decl)` projects
declaration → signature by dropping the expressions; this is the only crossing, used
when stamping a call-site snapshot and at serialization. Nothing converts back — the
expressions live only on the declaration.

On the wire a declaration splits into `{ functionInfo, outputAssignments }` (signature +
a `Record<uid, Expression>`); `function/serialization.ts` owns that split, the workflow
serializer adds the body.

### `FunctionNodeDefinition` — the synthesized render descriptor

```ts
FunctionNodeDefinition extends NodeDefinition { type: "FunctionCall"; functionInfo }
```

Every other node type has a *static* `NodeDefinition` registered in `NodeRegistry`. A
function call can't: its ports come from a user-defined signature that changes. So
`buildFunctionNodeDef(fnInfo)` (`node/FunctionNode.ts`) synthesizes one **on the fly** —
arguments become expression parameters, returns become static outputs. This is what
parameter editors and the canvas render against. There is no registered definition for
`FunctionCall` nodes; they are always built dynamically.

## `FunctionCallNode` — dynamic definitions and the staleness guard

A call site is an ordinary node (`node/FunctionNode.ts`):

```ts
{ type: "FunctionCall", functionInfo: FunctionInfo, arguments: Record<uid, …> }
```

`arguments` is the same flat uid-keyed bag every node uses (`Expression` for inputs,
`OutputBinding` for returns, plus a reserved `toolDescription`), so the rest of the
system treats it uniformly.

The node **caches a `functionInfo` snapshot** taken when it was created. This is
deliberate: the node renders its ports from its *own* snapshot via `buildFunctionNodeDef`
(`graph/FunctionCallNode.tsx`), so it draws correctly even if the live declaration was
edited or deleted. The cache is also the drift detector. Against the live registry
(`useFunctionRegistry` → `editorStore.functions`):

- **`isDeleted`** — no live declaration for `functionInfo.id`. The function is gone.
- **`isStale`** — `node.functionInfo.version !== liveDeclaration.version`. The signature
  changed since this snapshot was taken.

`version` bumps **only on signature edits** (add/remove/rename a port), never on a return-
expression edit — expressions don't affect call sites. `BaseNode` renders the stale/deleted
state so the user sees a call site that no longer matches its target.

## Auto-migration — keeping call sites in sync

When a declaration's signature changes, every `FunctionCall` referencing it is stale.
`utils/migrateFunctionNodes.ts` reconciles them **forward, automatically**:

- A module-level subscription watches `editorStore.functions` for a reference change.
  Any such change (the declaration record is replaced on every edit) triggers a sweep.
- `migrateFunctionCallNodes()` scans every canvas store, finds `FunctionCall` nodes whose
  snapshot `version`/`name` differs from the latest `toFunctionInfo(declaration)`, and
  rewrites them via `buildMigrationUpdate`: preserve each argument/binding whose `uid`
  still exists (refreshing its `dataType`), drop ports that vanished, default new ones,
  and replace the cached snapshot. Migrated count is surfaced as a toast.
- It writes through `updateNodeInStore` and creates **no undo entry** — migration is
  transparent.

**Why forward-only works:** declarations are not undo-tracked. Their cross-canvas side
effect (rewriting call sites elsewhere) can't be undone anyway, so making the declaration
a plain non-undoable resource edit means a signature change is a one-way reconcile — there
is no undo that could revert a signature out from under its call sites and desync them.
That is what lets migration be a simple `editorStore.functions` subscription rather than
the old "re-reconcile whenever you re-enter the canvas" safety net.

## File map

| Concern | File |
| --- | --- |
| Domain declaration + `toFunctionInfo` | `workflow-core/src/function/FunctionDeclaration.ts` |
| Declaration ⇄ wire split | `workflow-core/src/function/serialization.ts` |
| `FunctionCallNode`, `FunctionNodeDefinition`, `buildFunctionNodeDef` | `workflow-core/src/node/FunctionNode.ts` |
| Workflow (de)serialize, snapshot rebuild on load | `workflow-core/src/workflow/serialization.ts` |
| Declaration ownership (project-scoped, non-undo) | `workflow-builder/src/stores/editorStore.ts` |
| Declaration CRUD (version bump rules) | `workflow-builder/src/utils/functionOperations.ts` |
| Dynamic node-definition synthesis | `workflow-builder/src/hooks/useNodeDefinitions.ts` |
| Staleness/deleted guard at the call site | `workflow-builder/src/graph/FunctionCallNode.tsx` |
| Auto-migration + subscription | `workflow-builder/src/utils/migrateFunctionNodes.ts` |
