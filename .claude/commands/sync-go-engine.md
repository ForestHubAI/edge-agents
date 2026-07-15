# Sync Go Engine with API Contract

Synchronize the **Go** side — the `engine` runtime — with the current
`contract/workflow.yaml`. The TypeScript side has its own sync command
(`/sync-ts-domain`); this one does not touch `ts/`. Use this **after** the
contract YAML has been edited (or pulled in from `fh-backend`) to add/remove/change
nodes or their argument shapes.

The repo invariant: `contract/` is the source of truth, the generated
`go/api/workflow` package is its Go mirror, and the hand-written engine runtime
(node implementations + the build switch) must be reconciled by hand. This
command does that reconciliation.

## The one thing that makes Go riskier than TS

The TS `serialize`/`methods` switches are **exhaustive** — `tsc` refuses to
compile a missing arm. **Go's is not.** Node instantiation is a
`switch nd := val.(type)` in `go/engine/build/graph.go` with a `default:` arm that
returns `"unsupported node type %T"` **at runtime**. A forgotten `case` compiles
clean and would fail only when a workflow using that node is deployed.

The backstop for this is **`TestBuildSwitchHandlesEveryContractNode`** in
`go/engine/build/exhaustive_test.go`. It reads the node `type` set straight
out of `contract/workflow.yaml` (the source of truth) and asserts the build switch
has a `case` arm for every one of them. Add a node to the contract, regenerate,
forget the `graph.go` arm → that test fails by name pointing here. So `go test` —
not `go build` — is what enforces completeness; treat a red run of that test as
"you skipped Step 3 for some node."

## Step 0 — Regenerate the api layer

From `go/`:

```
go generate ./...
```

Regenerates the api layer (oapi-codegen) and mockery mocks. For node sync the file
that matters is `go/api/workflow/types.gen.go` (from `contract/workflow.yaml`); the
same directive also regenerates `llmapi`, `engineapi`, `debugapi`, and `deployapi`
from the other specs. Never hand-edit the `*.gen.go` files. If `git status` shows
`go/api/workflow/types.gen.go` dirty after this step, that diff IS the spec change
to react to — a new `XxxNode` struct, its `XxxNodeArguments`, and the
discriminator wiring in `Node.ValueByDiscriminator`.

## Step 1 — Internalise the layering before you touch anything

Read these _before_ diffing; they are canon.

- `go/CLAUDE.md` — package map, the node-contract interfaces
  (`Executable`/`Trigger`/`Emitter`/`ToolProvider`/`HasSetup`), and the
  "nodes instantiated once at build" model.
- `ts/workflow-core/docs/parameters.md` §1 — yes, the **TS** doc. It is the
  language-neutral presence table, and it drives the Go nullability mapping
  below just as it drives the TS one. Both sides mirror the same `required` set.

**The Go nullability rule (mirror of parameters.md §1 presence):**

```
API field in `required`      →  VALUE type in XxxNodeArguments  →  use directly
API field NOT in `required`  →  POINTER type (*T)               →  nil-check or deref
```

For a **not-required** field the generated arg is a pointer. Two ways to handle it
in the build arm, and you must pick per the field's contract:

- **Required-when-active / genuinely needed at runtime** → nil-check and fail:
  `if nd.Arguments.X == nil { return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "x"} }`
  then deref `*nd.Arguments.X`. (See `TickerNode.IntervalValue`, `AgentNode.Model`.)
- **Optional with a sane zero** → deref defensively with `pointer.Val(nd.Arguments.X)`
  (returns the zero value for nil) or a local `if … != nil` guard.
  (See `AgentNode.Name`, `ReadPinNode.ToolDescription`, `WebFetchNode.MaxChars`.)

This is the load-bearing decision and the one most likely to drift from TS: the
field's `required` membership in the contract dictates _both_ the TS
optional/required flag _and_ whether the Go arg is a pointer.

## Step 2 — Diff each surface vs the regenerated api

For each added/removed/changed `workflow.XxxNode`, there are three hand-written
surfaces:

### 2a. The build switch — `go/engine/build/graph.go`

The `(*graph).build()` method's `switch nd := val.(type)` has one `case
workflow.XxxNode:` arm per node type. Each arm:

1. validates required-at-runtime args (nil pointer → `MissingFieldError`),
2. resolves any hardware channel (`b.channels.uart/gpioInput/gpioOutput/adc/pwm/dac/mqtt(ref)`),
3. constructs via `node.NewXxx(...)` or `trigger.NewXxx(...)`,
4. registers into the right collections (see the collection rule below).

Diff the api `Node` union against the existing `case` arms:

- **New `XxxNode` type with no `case`** → add an arm.
- **Removed type still cased** → delete the arm.
- **Changed `XxxNodeArguments`** (added/removed field, value↔pointer, enum change)
  → update the arm's validation, deref, and constructor call.

**Collection registration rule** (every node also gets `b.allNodes[nd.Id] = n`):

| Node kind                          | interface                     | collections                                     |
| ---------------------------------- | ----------------------------- | ----------------------------------------------- |
| Executable (runs on state-runner)  | `engine.Executable`           | `b.executable[id]` + `allNodes`                 |
| Trigger (own goroutine)            | `engine.Trigger`              | `b.triggers[id]` + `allNodes`                   |
| Tool-only (never in state machine) | neither — `ToolProvider` only | `allNodes` **only** (see `WebSearchToolNode`)   |
| `OnStartup` / `OnFunctionCall`     | —                             | none; sets `onStartUpID`, defines initial state |

Tool-only nodes are partitioned into `b.tools` later by `wireEdges` when a `tool`
edge targets them — do **not** add them to `b.executables`.

### 2b. The node implementation — `go/engine/node/Xxx.go` (triggers: `go/engine/node/trigger/Xxx.go`)

Each node type has a hand-written file. For a new node, create it following the
existing pattern (e.g. `node/pinread.go`, `node/trigger/ticker.go`):

- **Embed** the right base: `engine.LinearNode` (one target/port, most executable nodes),
  `engine.BranchingNode` (multi-transition, e.g. agent), `engine.ToolNode`
  (tool-only), or `engine.TriggerNode` (triggers).
- **Implementation guards** up top: `var _ engine.Executable = (*Xxx)(nil)` and one
  per optional capability the node satisfies.
- **Constructor** `NewXxx(id, …)` taking the resolved/validated args from the build arm.
- **Core method:** `Execute(ctx, scope) (nextState string, err error)` for an
  Executable; `Wait(ctx) (Event, error)` + `Close() error` for a Trigger.
- **Optional capabilities**, implemented only if the node has them:
  - `Emitter` → `Outputs() map[string]workflow.DataType` (use `engine.FilterEmitted`
    - `engine.ApplyOutput` to honour emit-vs-bind output modes).
  - `ToolProvider` → `Tools() ([]llmproxy.FunctionTool, error)` (build via
    `llmproxy.NewFunctionTool`; description is usually a node arg).
  - `HasSetup` → `Setup(ctx) error` for fallible, ctx-bound init (hardware open, etc).

### 2c. Removed / changed cross-cutting api types

If the contract changed a shared `$ref` used in node arguments (`OutputBinding`,
`OutputDeclaration`, `DataType`, `Expression`, `Reference`, `MemoryRef`), grep the
`node` and `node/trigger` packages plus `engine/expr` for usages and reconcile each
touch point — these are re-exported from `go/api/workflow`, so a shape change ripples
through the constructors and `Execute` bodies.

## Step 3 — Apply the changes

For each **new** node type, in order:

1. **`go/engine/node/Xxx.go`** (or `node/trigger/Xxx.go`) — struct, guards,
   constructor, `Execute`/`Wait`+`Close`, and any `Emitter`/`ToolProvider`/`HasSetup`.
2. **`go/engine/build/graph.go`** — add the `case workflow.XxxNode:` arm:
   validate (nil-check required pointers → `MissingFieldError`), resolve channels,
   construct, register into the correct collection(s) per the 2a table.
3. **`go/engine/node/Xxx_test.go`** — testify test for `Execute`/`Wait`; use
   mockery mocks for drivers/llm/memory (regenerated by `go generate`).

For a **modified** node, touch only the changed fields across (1) and (2). For a
**removed** node, delete the impl file, the build arm, and any test — then
**grep for the now-absent `workflow.XxxNode` type** to catch stragglers, since the
non-exhaustive switch won't flag the deletion for you.

## Step 4 — Verify

From `go/`:

```
go generate ./...
go build ./cmd/engine
go test ./...
```

`go build` proves the impl + build arm compile, but **does not prove the switch is
complete** (§"the one thing") — `go test ./engine/build/` does, via
`TestBuildSwitchHandlesEveryContractNode`. That test is contract-driven and
covers new nodes automatically, so you do **not** need to add a per-node fixture
for switch coverage; if it's red, a node type is in the contract with no `case`
arm. (A behavioural test of the node's actual `Execute`/`Wait` still belongs in
`engine/node/Xxx_test.go` per Step 3 — that's a different concern from switch
completeness.)

If `contract/workflow.yaml` was edited (not just consumed), also run the TS side
via `/sync-ts-domain`. Otherwise the two languages silently drift — exactly the
failure mode the contract exists to prevent.

## Step 5 — Report

```
## Go Engine Sync Results

### Nodes
- Added `FooNode` — impl (node/foo.go), build arm (Executable → executables), test
- Modified `AgentNode.maxTurns`: value → pointer (now optional) — build arm deref
- Removed `BarNode` — impl, build arm, test; grepped `workflow.BarNode` clean

### Cross-cutting
- `OutputBinding.mode` new enum member reconciled in node/agent.go (or "no changes")

### Verification
- go generate ✅  go build ./cmd/engine ✅  go test ./... ✅
- TestBuildSwitchHandlesEveryContractNode ✅ (switch completeness, contract-driven)
```

Flag anything left to the user — e.g. a new hardware channel kind the node needs
that isn't yet in `engine/channel`, or a node whose `required` set you changed on
the Go side but not (yet) on the TS side via `/sync-ts-domain`.
