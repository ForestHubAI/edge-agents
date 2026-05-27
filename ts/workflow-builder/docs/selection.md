# Selection

How the builder tracks "what is the user focused on" — the thing that drives
right-side config-panel visibility, keyboard actions, and node/edge glow.

## Centralized in editorStore

Selection is a single value owned by `editorStore`:

```ts
type Selection =
  | { kind: "none" }
  | { kind: "graph"; nodeIds: string[]; edgeIds: string[] } // nodes+edges coexist
  | { kind: "channel"; id: string }
  | { kind: "memory"; id: string }
  | { kind: "model"; id: string }
  | { kind: "variable"; uid: string };
```

A discriminated union, so exclusivity is **structural**: at most one primitive is
ever selected (only `graph` holds two arrays, because a box-select can grab nodes
and edges together). There are no per-kind fields to keep mutually exclusive — the
only way to mutate is the actions, each of which **replaces the whole value**:

- `selectGraph(nodeIds, edgeIds)`, `selectChannel(id)`, `selectMemory(id)`,
  `selectModel(id)`, `selectVariable(uid)`, `clearSelection()`.

`RightConfigPanel` reads `selection` and switches on `kind` to decide which panel
(if any) to show. Everything else that needs the current focus reads the same
field. There is no second copy.

> `variable` is canvas-local (its uid resolves against the active canvas), so it is
> dropped on canvas switch. `channel`/`memory`/`model` are project-scoped and
> survive. See `setActiveCanvas`.

## ReactFlow keeps its own selection — the two must stay in sync

ReactFlow owns a `selected` boolean on each node/edge (that's what produces the
glow and what box-select/click manipulate). So node/edge selection lives in **two**
places — the canvas store's `selected` flags and `editorStore.selection` — and they
have to agree. The sync is bidirectional:

### Canvas → editor (`onSelectionChange`)

ReactFlow fires `onSelectionChange` whenever its selected set changes (click,
box-drag, deselect). `BuilderLayout` forwards that to `syncSelectionFromRF(nodeIds,
edgeIds)`, which writes the result into `editorStore.selection`. This is the
**only** path that may not push back to ReactFlow — ReactFlow is the origin, so
echoing would loop.

### Editor → canvas (programmatic selects)

`selectGraph` (diagnostics jump, auto-select after connecting an edge, "go to node")
sets `selection` **and** mirrors it into ReactFlow via the canvas store's
`setRFselect(nodeIds, edgeIds)` so the glow matches. The resource selects
(`selectChannel`/`Memory`/`Model`/`Variable`) and `clearSelection` instead call
`setRFselect([], [])` to drop any node/edge glow, since their panel takes over.

## The echo

Because the editor pushes into ReactFlow, and ReactFlow notifies on **any**
selection change, every programmatic push round-trips back through
`onSelectionChange` → `syncSelectionFromRF`. `onSelectionChange` carries no origin
info, so it can't tell "the user did this" from "we just did this." Two cases:

- **`selectGraph` echo** — comes back as the same non-empty set. `syncSelectionFromRF`
  just re-sets an equal value: one benign re-render, no special-casing needed.
  (`setRFselect` is a single atomic update, so this is one echo, not one per array.)
- **Resource-pick / clear echo** — `setRFselect([], [])` makes ReactFlow report an
  *empty* selection. `syncSelectionFromRF` only acts on empty when the current kind
  is `graph` (a real canvas deselect); when the kind is `channel`/`memory`/etc. the
  empty is the echo of our own clear and is **ignored**, or it would wipe the pick
  the user just made.

This is the one load-bearing subtlety. It's why `syncSelectionFromRF` guards the
empty branch on `kind === "graph"`.

## Not exposed to the host

Selection is editor-internal — there is no `onSelectionChange` prop on
`WorkflowBuilder` and no selection methods on its imperative handle. It drives the
builder's own panels and nothing crosses the component boundary. If a host ever
needs "open focused on node X", add a narrow intent method (e.g. `revealNode`)
rather than exposing the selection model.
