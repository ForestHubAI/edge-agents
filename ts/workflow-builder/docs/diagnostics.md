# Diagnostics System

## Overview

The diagnostics system validates nodes and edges in the workflow builder, surfacing errors (invalid expressions, missing parameters) and warnings (unconnected ports, stale functions) to the user. It uses a **render-based architecture**: diagnostics are computed inside React components and stored in a flat Zustand store that always reflects the currently active canvas.

## Architecture

### Two layers

1. **Pure functions** (`utils/diagnostics.ts`) — stateless computation, no React dependency, re-usable for project-wide diagnostics check before export
2. **Render-based lifecycle** — React components derive their own diagnostics via the pure functions with `useMemo` and write results to a flat store via `useEffect`

### Key files

| File                        | Role                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `utils/diagnostics.ts`      | Pure functions: `computeNodeDiagnostics()`, `computeEdgeDiagnostics()`, `validateAllCanvases()` |
| `store/diagnosticsStore.ts` | Flat Zustand store: `byNodeId`, `byEdgeId`                                                      |
| `graph/BaseNode.tsx`        | Computes + writes node diagnostics on render, clears on unmount                                 |
| `graph/CustomEdge.tsx`      | Computes + writes edge diagnostics on render, clears on unmount                                 |

## Render-Based Lifecycle

Diagnostics stay in sync with the canvas through React's component lifecycle — specifically, the `useEffect` cleanup pattern:

```typescript
// In BaseNode.tsx
useEffect(() => {
  // Setup: runs after mount and after every re-render where deps changed
  setNodeDiagnostics(id, diagnostics);
  // Cleanup: runs before next effect run AND on component unmount
  return () => clearNodeDiagnostics(id);
}, [id, diagnostics, setNodeDiagnostics, clearNodeDiagnostics]);
```

This pattern means diagnostics are **automatically** kept in sync across all scenarios:

### Node/edge created

Component mounts -> `useMemo` computes diagnostics -> `useEffect` setup runs -> diagnostics written to store.

### Node/edge deleted

Component unmounts -> `useEffect` cleanup runs -> diagnostics cleared from store.

### Parameter edited

Component re-renders -> `useMemo` recomputes diagnostics -> deps change -> cleanup runs (clears old), setup runs (writes new).

### Undo/redo

Canvas store snapshot is restored -> `nodes`/`edges` arrays replaced wholesale -> React reconciles:

- Nodes that still exist: re-render, diagnostics recomputed via `useMemo`
- Nodes restored (were deleted): mount, diagnostics written
- Nodes removed (were added): unmount, diagnostics cleared

### Canvas switch

`CanvasLayout` remounts via `key={activeTabId}` -> all old components unmount (cleanup clears entire store) -> new canvas components mount (setup populates store with new canvas diagnostics).

### Project load

`initialize()` replaces nodes/edges -> same reconciliation as undo/redo.

**The key insight:** because diagnostics lifecycle is tied to React component lifetime, there is no code path where diagnostics can become stale. You never need to manually clear diagnostics when deleting nodes, switching canvases, or performing undo/redo — React handles it.

## Diagnostics Store

The store is intentionally flat (no per-canvas nesting):

```typescript
interface DiagnosticsState {
  byNodeId: Record<string, Diagnostic[]>;
  byEdgeId: Record<string, Diagnostic[]>;
  // set/clear methods...
}
```

Since only one canvas is rendered at a time, the store only holds diagnostics for the active canvas. On canvas switch, unmount cleanups clear everything, then mount setups repopulate it. This simplifies all consumers — no need to pass `canvasId` to read diagnostics.

## Full-Project Validation

The render-based approach only covers the active canvas (non-rendered canvases have no components to compute diagnostics). For the "Generate C Code" action, which must validate **all** canvases, there's a separate on-demand function:

```typescript
// utils/diagnostics.ts
function validateAllCanvases(): { hasErrors: boolean; errorCount: number };
```

This function:

- Iterates all canvas stores via `getAllCanvasStores()`
- Computes available variables per canvas via `computeAvailableVariables()`
- Resolves node definitions (including FunctionCall staleness/deletion checks)
- Runs `computeNodeDiagnostics()` and `computeEdgeDiagnostics()` for every node/edge
- Returns aggregate error count

It does **not** write to the diagnostics store — the store is exclusively for render-based, active-canvas diagnostics. The toolbar calls `validateAllCanvases()` before proceeding with code generation and blocks if errors are found.

## Pure Diagnostic Functions

Both functions are stateless and can be called from React components or imperatively:

### `computeNodeDiagnostics(opts)`

Checks performed:

- `function-deleted` — FunctionCallNode references a deleted function
- `function-stale` — FunctionCallNode's snapshot version differs from registry
- `invalid-expression` — expression fails parsing/type checking
- `missing-required-param` — required parameter is empty
- `unconnected-input` — control/tool input port has no incoming edge
- `tool-not-connected` — tool-only node isn't connected to any agent

### `computeEdgeDiagnostics(opts)`

Checks performed:

- `missing-required-param` — parametrized edge (agentTask, agentChoice, etc.) missing required field
- `invalid-expression` — edge expression parameter fails validation

## UI Consumers

| Consumer            | What it reads                                                                    |
| ------------------- | -------------------------------------------------------------------------------- |
| `BaseNode`          | Own diagnostics (locally computed, not from store) — drives error/warning badges |
| `CustomEdge`        | Own diagnostics (locally computed) — drives error icon and red coloring          |
| `NodeConfigPanel`   | `byNodeId[selectedNode.id]` — highlights errored parameter fields                |
| `DiagnosticsPanel`  | All of `byNodeId` + `byEdgeId` — lists all issues with click-to-select           |
| `BuilderSidebar`    | Counts from `byNodeId` + `byEdgeId` — badge count and icon coloring              |
| `CanvasToolbar`     | Calls `validateAllCanvases()` on "Download Code" click                           |
| `useCodeGeneration` | Calls `validateAllCanvases()` before API call                                    |
