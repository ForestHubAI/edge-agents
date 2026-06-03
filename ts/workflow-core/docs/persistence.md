# Persistence & Schema Versioning

What `workflow-core` saves to disk, and how it loads documents written by older
builds. For the layering these formats sit in (api ⇄ domain ⇄ stores) see
[architecture.md](./architecture.md).

## The api Workflow is the canonical save/export format

There are three representations of a workflow (see architecture.md), but only one
is ever persisted: the **api** `Schemas["Workflow"]` (`ApiWorkflow`), generated from
`contract/workflow.yaml`. It is the wire format the Go backend produces and
consumes, and it is also the on-disk format — the JSON a user saves and reopens.

- **domain `Workflow`** is an in-memory intermediary for validation and conversion.
  It is _not_ persisted.
- **editor stores** (Zustand + React Flow, in workflow-builder) are live editor
  state. They are _not_ persisted either.

Both reduce to the api format at the boundary, so saving is always
`stores → domain → api` and loading is always `api → domain → stores`:

```
                 save / export                          load / import
editor stores ──► readStateFromStores ──► serialize ──► ApiWorkflow (JSON on disk)
                          (domain)                              │
                                                                ▼
editor stores ◄── hydrate ◄── deserialize ◄── migrate ◄── ApiWorkflow (parsed)
                          (domain)
```

- **Export.** `serialize(domain)` (`workflow/serialization.ts`) is the only writer.
  It stamps `schemaVersion: CURRENT_SCHEMA_VERSION` into every document it produces,
  alongside `nodes`/`edges`/`functions`/`declaredVariables`/`channels`/`memory`/
  `models`. The builder reaches it through `useWorkflowSerialization.exportProject`;
  the CLI through nothing — it only ever reads.
- **Import.** `deserialize(api)` is the only reader of the api shape. But raw JSON
  off disk is _untyped_ and may have been written by an older build, so a document
  must pass through `migrate` **before** `deserialize` — see below.

`schemaVersion` is a **required** field in the contract (`minimum: 1`). Every
document `serialize` writes carries it; documents from before the field existed are
handled by the baseline default during migration.

## Schema version: how the build declares its format

The persisted-format version is a plain **monotonic integer**, defined in
`migration/version.ts`:

```ts
export const CURRENT_SCHEMA_VERSION = x; // what this build reads and writes
export const BASELINE_SCHEMA_VERSION = 1; // assumed for documents with no schemaVersion
```

It is **deliberately decoupled from the package/contract semver.** A `workflow-core`
release bump does not move the schema version; only a change to the _serialized
`ApiWorkflow` shape_ does. Bump `CURRENT_SCHEMA_VERSION` only when `serialize`'s
output would no longer round-trip through an older `deserialize` — adding an
optional field that old readers ignore does not require a bump; renaming, removing,
or restructuring a field does.

`BASELINE_SCHEMA_VERSION` is the version assumed for any document that lacks a
`schemaVersion` (documents written before the field, or hand-authored JSON). Today
both constants are `1`, so the baseline is the current version and there is nothing
to migrate yet.

## Migrating older schemas on import

Migration is **forward-only** and runs as a chain of single-step transforms, each
upgrading the raw document from version `N` to `N + 1`. The pieces live in
`src/migration/`:

| file            | role                                                          |
| --------------- | ------------------------------------------------------------- |
| `version.ts`    | the two version constants                                     |
| `migrations.ts` | the `Migration` interface + the ordered `MIGRATIONS` registry |
| `migrate.ts`    | `migrate()` (run the chain) and `readSchemaVersion()`         |
| `index.ts`      | the `@foresthubai/workflow-core/migration` barrel             |

### A migration

```ts
interface Migration {
  readonly from: number; // input version; produces from + 1
  migrate(doc: Record<string, unknown>): Record<string, unknown>; // pure, no mutation
}
```

Two rules make the chain safe:

- **Migrations run on the raw, untyped document** (`Record<string, unknown>`), never
  on the domain types. Each step stays pinned to the exact JSON shape it was written
  for, so it keeps working even after the domain types move on.
- **A shipped migration is immutable.** Saved files on disk depend on its exact
  behaviour. The next format change is always a _new_ migration appended to the
  registry — never an edit to an existing one.

`MIGRATIONS` is currently empty (`CURRENT === BASELINE === 1`), with the first
entry slated to be `{ from: 1, migrate: … }` once the format first changes.

### Running the chain — `migrate(raw)`

```
parsed JSON  ──►  migrate(raw)  ──►  ApiWorkflow (at CURRENT_SCHEMA_VERSION)  ──►  deserialize
```

`migrate` (`migrate.ts`):

1. Rejects anything that is not a JSON object.
2. Reads the document's version via `readSchemaVersion` — an explicit integer ≥
   baseline, otherwise the baseline (so missing / non-integer / out-of-range all
   default to `BASELINE_SCHEMA_VERSION`).
3. Rejects a version **newer** than this build supports (a document from a future
   build) rather than silently mishandling it.
4. Applies each `MIGRATIONS` step in order from the document's version up to
   `CURRENT_SCHEMA_VERSION`.
5. Stamps `schemaVersion = CURRENT_SCHEMA_VERSION` and returns the document typed as
   `ApiWorkflow`, ready for `deserialize`.

It does **not** mutate its input — it shallow-copies first.

`migrate.ts` validates the registry at module load (`buildChain`): the `from` values
must form a contiguous, gap-free, duplicate-free chain over
`[BASELINE_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)`. A missing or duplicate step
throws immediately, turning a misconfigured chain into a load-time crash rather than
a silent data bug on first import.

### Where `migrate` is called — the import boundary

`migrate` and `deserialize` stay **separate single-responsibility functions** —
`migrate` is version policy on raw JSON, `deserialize` is a pure mapper on a typed,
already-current `ApiWorkflow`. `migrate` is **not** folded into `deserialize` (that
would force its input to widen from `ApiWorkflow` to `unknown` and conflate the two
concerns). Instead, every load boundary runs `migrate` before `deserialize`, so an
older document is always brought current and no caller can forget the step:

- **Builder/editor**: `useWorkflowSerialization.importProject` (behind the
  `<WorkflowBuilder>` handle's `loadWorkflow`) runs `deserialize(migrate(workflow))`.
  The handle still accepts a typed `ApiWorkflow`; `migrate` on an already-current
  document is a near no-op (reads the version, runs no steps, re-stamps), so running
  it unconditionally is safe and cheap. (The builder's own `migrateFunctionNodes` is
  unrelated — it reconciles stale FunctionCall nodes against function definitions,
  not schema versions.)
- **CLI** (`ts/workflow-cli/cli`): `validate.ts` and `update.ts` both `JSON.parse` then
  `migrate(parsed)` before doing anything else. `fh-workflow update <file>` exists
  purely to migrate a document up to the current version and write it **back to
  disk** (reporting `schemaVersion N → CURRENT`); it uses `readSchemaVersion` to
  detect the already-current no-op case. This is distinct from load-time migration,
  which is in-memory only — `validate` migrates to check the document but never
  persists the result, so `update` remains the only non-interactive way to bring a
  stored file current.

## Adding a format change — the checklist

When the serialized `ApiWorkflow` shape changes incompatibly:

1. Edit `contract/workflow.yaml` and regenerate both sides (the repo's one rule).
2. Reconcile the hand-written `serialize`/`deserialize` for the new shape.
3. Bump `CURRENT_SCHEMA_VERSION` in `version.ts`.
4. Append one `Migration` to `MIGRATIONS` with `from` set to the previous current
   version. Write it against the raw JSON shape; never touch a shipped migration.
5. Add a migrate test covering an old → current document.

`serialize` writes the new version automatically (it reads
`CURRENT_SCHEMA_VERSION`); `buildChain` will fail at load if you bump the version
without appending the matching step.
