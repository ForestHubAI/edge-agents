# Change notification & dirty tracking

How the builder tells a host "something changed" (so it can mark the document
dirty) and "undo/redo availability changed" (so it can drive toolbar buttons).
These are **two deliberately separate signals** — `onChange` and `onHistoryChange`
— built on one primitive: `mutationCount`.

## The primitive: `mutationCount`

A monotonic counter that bumps on a domain mutation and on nothing else. It is
**opaque**: consumers only ever compare "is it different from the value I last
saw?" — never interpret its magnitude, never persist it. There are two independent
sources, mirrored by design so the builder can watch both the same way:

### Per-canvas (history middleware — `utils/history.ts`)

The `history` Zustand middleware adds `mutationCount` (type `MutationCount`) to
every canvas store. It bumps on every **history transition**:

- `takeCheckpoint` / `withCheckpoint` (the latter only if state actually changed)
- `undo`, `redo`
- `clearHistory`, `importHistory`

It does **not** bump on `setNodes`/`setEdges` that skip a checkpoint — i.e.
selection (`setRFselect`) and drag. That's the whole point: watching
`mutationCount` instead of the raw `nodes` array makes the signal honest for
undo/redo and silent on view-state, which a raw store subscription can't be (the
`selected` flag lives inside the `nodes` array).

Each canvas (main + every function) has its **own** store and its own counter and
its own history.

### Project-scoped (`stores/editorStore.ts`)

`editorStore` carries its own `mutationCount`, bumped only by the project-scoped
declaration edits that don't pass through any canvas history:

- `setChannels`, `setMemory`, `setModels`, `setFunctions` — and only when the
  record reference actually changes (each guards `if (next === prev) return state`).

Functions are a project-scoped resource: their declaration (signature + return
expressions) lives in `editorStore.functions`, so **adding, deleting, renaming, or
editing a function** is a `setFunctions` reference change that bumps this counter —
the same path as channels/memory/models. There is no separate function-registry
change signal anymore. (The function *body* edits are ordinary canvas-history
mutations on the function's own canvas store.)

It deliberately does **not** bump on `selection` changes, `setActiveCanvas`,
`setBuilderMode`, or `setAvailableModels` (the model catalog is host-supplied
config, not workflow content).

> **Undo/redo bump, they don't decrement.** The counter is strictly increasing.
> "Undo" is itself a change the host should hear about, so it fires `onChange`. A
> consequence: undoing back to the last-saved state still reports a change — the
> builder has no notion of "equal to the saved document," so it can't un-dirty. If
> a host wants content-exact dirtiness it must diff `exportWorkflow()` itself; the
> counter only answers "did anything happen since I last looked."

## `onChange` — domain mutated

`WorkflowBuilder` aggregates every mutation source into one pulse. The subscription
effect mounts **once** (callbacks are stashed in refs, `onChangeRef`):

- Subscribes to **every** canvas store, each tracking its own previous count (a
  `WeakSet` prevents double-subscribing the same instance).
- Subscribes to `editorStore.mutationCount` for project-scoped edits (channels,
  memory, models, **and functions** — see above).
- Subscribes to the **canvas registry** (`subscribeCanvasRegistryChanges`): when the
  *set* of canvas stores changes (a function body is created/deleted, or a project
  load rebuilds them), it re-runs `subscribeAllCanvases()` so newly created stores
  get watched and dropped ones fall away. It does **not** fire `onChange` itself —
  the function declaration change that accompanies a create/delete already flows
  through `editorStore.mutationCount`, so firing here too would double-count.

**Baseline / no fire on load:** each subscription captures the current count as its
starting `prev`, so initial mount doesn't fire. `onChange` carries **no payload** —
it's a pulse; the host pulls current state via `handle.exportWorkflow()`.

**Loads do NOT fire it.** `loadWorkflow`/`clear` mutate the same stores, but the
handle raises a suppression flag around them (`suppressChangeRef`); the
subscriptions still track the new counts (so the next real edit fires exactly
once) but stay silent. `onChange` therefore means "the *user* changed the
document" — hosts reset their dirty flag right after a programmatic load, no
echo guard needed. This works because zustand notifies synchronously inside the
store write; the flag is guaranteed up while load-triggered callbacks run.

## `onHistoryChange` — undo/redo availability

A separate effect emits `{ canUndo, canRedo }` for the **active canvas only**
(`canUndo`/`canRedo` read the history's `_history_past`/`_history_future` lengths).
It is distinct from `onChange` on purpose:

- It binds to the active canvas store and emits on that store's changes, but
  **dedupes** — it only calls the host when the boolean pair actually flips.
- It **rebinds** on tab switch (active canvas changed) and on store rebuilds from
  load/clear (registry notification). A tab switch changes which history is active
  *without being a domain mutation* — so it must update the buttons but must **not**
  mark the document dirty. That separation is exactly why this isn't folded into
  `onChange`.

## Host responsibility: "dirty" lives in the host

The builder emits change *pulses*; it does not track dirtiness, because only the
host knows what "saved" means. The reference app (`ts/workflow-cli/src/App.tsx`) does:

- `onChange` → `setDirty(true)`, unguarded — loads don't echo (see above).
- After a successful save/open/new, it calls `setDirty(false)`.
- `dirty` drives a dot in the window title.

So the contract is: **builder says "something changed"; host decides what dirty
means and when it's clean.** If you need content-exact dirty (undo-to-saved should
clear the dot), that's a host-side diff of `exportWorkflow()`, not something the
counter can provide.
