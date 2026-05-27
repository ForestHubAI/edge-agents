# workflow-builder

`@foresthubai/workflow-core`'s React companion: `@foresthubai/workflow-builder` —
the visual canvas/editor component library. Depends on `workflow-core` for types,
serialization, and validation; **never** imports `app`. Consumed by `app` and by
the closed FE. Read `ts/CLAUDE.md` first for the workspace-wide rules (the
`contract/` source-of-truth rule reaches here via `workflow-core`).

## What it is

A single embeddable component, `<WorkflowBuilder>`, plus a small public surface
(`src/index.ts`). The host passes a workflow in and drives it through an imperative
handle; everything else — canvas, sidebars, config panels, dialogs, toasts — is
internal. This is **layer 3** in the workspace model (live editor state); it owns
the Zustand/React-Flow stores that `workflow-core` never sees.

```
WorkflowBuilder.tsx   Public contract (props + imperative handle), i18n + toast
                      providers, validation entry, function/tab orchestration.
BuilderLayout.tsx     Chrome composer: sidebar, keyboard handlers, graph handlers.
                      Stable across canvas switches; CanvasEditor remounts per canvas.
Canvas.tsx /          The ReactFlow surface and its wiring.
CanvasEditor.tsx
RightConfigPanel.tsx  Selection-routed config panel (switches on selection.kind).

stores/    editorStore (project-scoped + selection), canvasStore (per-canvas
           registry), debugStore, diagnosticsStore.
graph/     ReactFlow node/edge components + registry (BaseNode, CustomEdge, …).
panels/    Sidebar + per-primitive config/list panels.
hooks/     useGraph, useCanvasHistory, useFunctions, useWorkflowSerialization, …
inputs/    Expression + parameter editors.
utils/     *Operations.ts (channel/memory/model/variable CRUD), serialization helpers.
i18n/      The builder's PRIVATE i18next instance (see gotcha below).
docs/      Design notes — architecture.md (component tree/ownership), selection.md.
```

For the component tree, what owns what, and prop/data flow, see
`docs/architecture.md`. For the selection model and its ReactFlow sync, see
`docs/selection.md`.

## Stores — the editor-state layer

Two stores carry workflow state; both are **module-level singletons**, not React
context.

- **`editorStore`** — one instance. Holds project-scoped declarations shared across
  all canvases (`channels`, `memory`, `models`) and the centralized **`selection`**.
  Also: `activeCanvasId`, `activeSidebarTab`, `builderMode`.
- **`canvasStore`** — a **registry** of independent stores keyed by canvas id
  (`getOrCreateCanvasStore(id)`). `MAIN_CANVAS_ID` always exists; each function gets
  its own. A canvas store holds that canvas's ReactFlow `nodes`/`edges`, `variables`,
  `functionInfo`, and **its own undo/redo history** (`useCanvasHistory`). Selection of
  nodes/edges lives here as ReactFlow's `selected` flags **and** is mirrored into
  `editorStore.selection` — see `docs/selection.md` for the two-way sync and the echo.

### Projection boundary (stores ⇄ domain ⇄ api)

The stores are editor shape, not a persistence format. They cross to
`workflow-core` only through serialization:

```
api (ApiWorkflow) ⇄ workflow-core serialize/deserialize ⇄ domain ⇄ readStateFromStores/hydrate ⇄ stores
```

`loadWorkflow`/`exportWorkflow` (the handle) move an `ApiWorkflow` across this
boundary. **Validation always runs on the domain** via `validateWorkflowState(readStateFromStores())`
— never validate stores or api shapes directly.

## Public contract

`WorkflowBuilderProps` (host asks, builder does): `initialWorkflow`, `initialMode`,
`models` (static catalog), `language`, plus embedder-fulfilled actions
(`onTestNode`, `onDebugStep`) and lifecycle events (`onChange`, `onHistoryChange`,
`onError`). `WorkflowBuilderHandle` exposes document-level ops: `loadWorkflow`,
`exportWorkflow`, `clear`, `setMode`/`getMode`, `validate`, `undo`/`redo`,
`setDebugPhase`. The host owns locale, the file, and its own toolbar; the builder
follows.

Keep the surface coarse. Document-level operations belong on the handle; fine-grained
interaction state (selection, hover) does **not** cross the boundary. If a host need
appears, add a narrow intent method (e.g. `revealNode`) rather than exposing internals.

## Gotchas

- **Private i18n.** The builder ships a fully isolated `react-i18next` instance
  (`src/i18n`) mounted via its own `I18nextProvider`, with **no** `initReactI18next`
  / `setI18n`. This is deliberate so it never clobbers the host's global i18next, and
  the host needs no provider. Do **not** re-add `.use(initReactI18next)`.
- **Selection has two sources of truth** (ReactFlow `selected` flags + `editorStore.selection`)
  kept in bidirectional sync. The empty-echo guard in `syncSelectionFromRF` is
  load-bearing. Before touching it, read `docs/selection.md`.
- **Read-only mode** (`isReadOnly` → preview/debug) blocks domain mutations.
  Visual-only ops (e.g. `canvasStore.setRFselect`, history-free) stay allowed.
- **No generated code here**, but the contract rule still binds: types flow from
  `contract/` through `workflow-core`. A `workflow-core` regen can ripple into builder
  code — reconcile by hand.

## Build / test / lint

Run from `ts/` (see `ts/CLAUDE.md`): `npm run build`, `npm run typecheck`,
`npm run lint`. Package-local: `npm run build` (`tsc -b`) and `npm run test`
(Vitest). Builder tests are sparse — `stores/canvasStore.test.ts` is the main one;
most verification is manual via the `app` dev server (`npm run dev`). Path aliases
resolve to `src/` in-repo, so no build step is needed during development.
