# Architecture

The component tree and what owns what. For the store/state model and the
projection boundary see `../CLAUDE.md`; for selection specifically see
`selection.md`.

## Component tree

```
WorkflowBuilder            public contract + imperative handle, store subscriptions,
│                          i18n/tooltip/toast providers, owns canvas tabs + the
│                          function open/create coordinator, renders ValidationDialog + Toaster
└── BuilderLayout          chrome composer; sidebar tab state, useGraph/useCanvasHistory
    │                      bound to activeCanvasId, keyboard handlers, viewportCenterRef,
    │                      selectionDrag flag
    ├── BuilderSidebar         left rail (node library, resources incl. Functions, variables, diagnostics)
    ├── CanvasTabsToolbar      main + function canvas tabs (view-only function-open dropdown)
    ├── CanvasEditor           key={canvasId} → remounts per canvas; owns the
    │   │                      port-action popup + NodePickerDialog
    │   └── Canvas             the ReactFlow surface (RF primitive)
    ├── RightConfigPanel       selection-routed config panel (switch on selection.kind;
    │                          selection.kind === "function" → FunctionConfigPanel)
    └── DebugConsolePanel      below the canvas in debug mode only
```

Functions are a project-scoped resource: the **Functions** sidebar list
(`FunctionListPanel`) creates/opens them, and the definition (name, ports, return
expressions) is edited in the right-side `FunctionConfigPanel` like any other
resource. There is no function-creation dialog — creation is the sidebar list's add
button.

## What lives where, by lifetime

- **WorkflowBuilder** — survives everything. Owns the canvas-tab list, the function
  open/create coordinator (`useFunctions`), and the imperative handle. Mounts the
  providers and the global dialogs/toaster.
- **BuilderLayout** — survives canvas switches. Owns UX state (active sidebar tab,
  selection-drag flag) and all graph + keyboard handlers, bound to `activeCanvasId`.
  The handlers stay stable enough to hand to the sidebar; their closures refresh when
  the active canvas changes.
- **CanvasEditor** — remounts on canvas switch (`key={canvasId}`). Owns only state
  tied to one canvas's ReactFlow instance — the port-action popup and its picker.

State that outlives components (the workflow itself, selection, history, per-canvas
nodes/edges) lives in the Zustand stores, not in component state. See `../CLAUDE.md`.

## What flows where, by direction

- **WorkflowBuilder → BuilderLayout:** canvas-tab list + tab callbacks, function
  open/create callbacks, embedder callbacks (`onTestNode`, `onDebugStep`).
- **BuilderLayout → CanvasEditor:** `canvasId`, `viewportCenterRef` (passthrough to
  ReactFlow), the graph/selection/pane event handlers, `setSelectionDrag`.
- **BuilderLayout → RightConfigPanel:** `canvasId`, mutation handlers (bound to the
  active canvas's `useGraph`), the `selectionDrag` flag, `onClearSelection`.
- **BuilderLayout → BuilderSidebar:** node definitions/categories, `onSelectNode`/
  `onSelectEdge`, function list + open/create, mode flags.

Note the flow is props **downward** for wiring, but workflow state moves through the
stores — components read it via `useEditorStore` / the canvas store directly rather
than threading it through props.

## Why the handle lives on WorkflowBuilder

Every handle method — `loadWorkflow`, `exportWorkflow`, `clear`, `setMode`/`getMode`,
`validate`, `undo`/`redo`, `setDebugPhase` — operates on the global Zustand stores via
`getState()`, not on per-canvas component state. So the handle needs no access to any
inner-component refs, and belongs at the top where the public contract is defined.
`undo`/`redo` resolve the active canvas from `editorStore` and act on that canvas
store's history.
