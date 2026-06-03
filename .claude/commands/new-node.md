---
description: Author a new workflow node end-to-end — interview intent, design the contract schema, then reconcile both the TS and Go sides.
argument-hint: [free-form description of the capability the node should provide]
---

# New Node

Add a new node to the workflow platform, all the way through: a **contract schema
change** (the source of truth) followed by reconciliation of the hand-written
TypeScript domain and the Go engine. This command **orchestrates** — it does the
intent capture and the contract design itself, then delegates the mechanical
mirroring to `/sync-ts-domain` and `/sync-go-engine`.

The repo invariant governs everything here: `contract/` is the source of truth,
both languages codegen from it, and the hand-written domain on each side must be
reconciled by hand. Editing only one side is how Go and TS silently drift.

## Step 0 — Capture intent

`$ARGUMENTS` holds the user's free-form description of the capability.

- **If it's non-empty**, treat it as the intent.
- **If it's empty**, ask the user in plain text what the node should do, and wait.
  Do not invent a node.

Then **restate the capability in one sentence and confirm** before going further.
Do not proceed on a vague one-liner — pin down what the node consumes, what it
produces, and what (if anything) the user configures on it.

## Step 1 — Interview the branching decisions

Ask **only** what you cannot derive from the docs. Use **AskUserQuestion** (one
batched call) for the closed-set forks below — they map directly to code arms in
the sync commands, so getting them wrong is expensive:

1. **Node category** — one of `Input | Output | Trigger | Tool | Logic | Data |
   Agent | Mqtt | Function`. This picks which `src/node/<Category>Node.ts` the
   interface and `NodeDefinition` live in, and the category union it joins.
2. **Tool-capable?** — does it expose a tool input port? Drives the `getPorts`
   arm in `src/node/methods.ts`.
3. **Hardware I/O in debug mode?** — does it consume external hardware I/O?
   Drives whether it's added to `getInput()`.

**Do NOT interview the schema mechanics.** Parameter presence (in/out of the API
`required` array), `optional` vs `activationRules`, list-defaults-to-`[]`,
required-vs-default scalars — all of that you **derive** from
`ts/workflow-core/docs/parameters.md` §1 against the capability. The user does not
think in `required`-array terms; asking would just hand them your homework. If a
question's answer is dictated by parameters.md, delete the question.

## Step 2 — Design and edit the contract

Read the canon first — these win over anything below if they conflict:

- `ts/workflow-core/docs/parameters.md` — **the load-bearing one.** §1 presence
  table maps each field to its `Parameter` variant and whether its key is in the
  API `required` array. §2 list invariant, §3 `optional` vs `activationRules`,
  §4 serialize boundary.
- `ts/workflow-core/docs/architecture.md` — domain ⇄ api layering, `Api`-prefix
  naming, where serialize/deserialize live.

Then design the node and edit `contract/workflow.yaml`:

- Add the new `type` value to the `Node` discriminated union.
- For each configurable field, pick the API field shape from the parameters.md §1
  row for the intended `Parameter` variant, and decide `required` membership by
  the **presence** rule: a key is in `required` **iff** it is always present and
  is neither `optional` nor activation-gated. Lists that default to `[]` are
  always-present → stay in `required`; clearable scalars (string, optional
  numbers, selects) are **not** in `required`.
- Carry **no defaults** in the contract — the backend has no concept of them;
  defaults are definition-only on the TS side.

Stop and show the user the proposed contract diff before regenerating. This is the
one irreversible-by-codegen decision; get a nod here.

## Step 3 — Reconcile the TypeScript side

Invoke **`/sync-ts-domain`**. It regenerates the TS api layer from the contract
and reconciles the `workflow-core` domain (interface, `NodeDefinition`, registry,
ports, both serialize arms) plus any builder knock-on. Let it run its own verify
(`typecheck` / `lint` / `test`); do not duplicate that work here.

## Step 4 — Reconcile the Go engine side

Invoke **`/sync-go-engine`**. It regenerates the Go api bindings, adds the node's
implementation under `engine/node`, and wires the `case` arm in the build switch.
Note its load-bearing warning: the Go type switch is **not** compiler-exhaustive,
so a forgotten arm fails only at deploy time — completeness is instead enforced by
`TestBuildSwitchHandlesEveryContractNode` (`go test ./engine/build/`), which reads
the node set from the contract. A green `go build` is not enough; that test must
pass.

## Step 5 — Cross-language verify

Both sides must build green off the same contract, or they've drifted:

- TS (from `ts/`): `npm run typecheck && npm run lint && npm run test`
- Go (from repo root): `cd go && go build ./...`

The exhaustive `switch` statements on each side catch missing arms — fix until
clean. A regeneration diff that isn't accounted for means the contract and the
checked-in bindings are out of sync.

## Step 6 — Report

```
## New Node: <TypeName> (<Category>)

### Contract
- Added `type: <value>` to Node union — fields: <field: variant (required?)>, ...

### TypeScript  (via /sync-ts-domain)
- interface, NodeDefinition, registry, ports, serialize/deserialize ✅

### Go  (via /sync-go-engine)
- bindings regenerated, engine domain/handlers reconciled ✅

### Verification
- TS: typecheck ✅  lint ✅  test ✅
- Go: build ✅
```

Flag anything left to the user — e.g. an i18n description key needing
`/sync-translations`, or a builder panel that hard-codes node types by string
literal.
