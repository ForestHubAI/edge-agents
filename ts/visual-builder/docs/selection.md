# Selection

## Overview

Selection tracks which nodes/edges are UI-focused — driving config panel visibility, keyboard actions (delete, copy), and visual glow highlighting. Selection state is split across two layers, each serving a different consumer.

## Two Layers

### 1. ReactFlow's `node.selected` / `edge.selected` — Visual Layer

ReactFlow manages `selected` as a boolean on each node/edge object, pushed through `onNodesChange` → `setNodes` on the canvas store. Node and edge components receive `selected` as a prop and use it for the glow effect:

```typescript
// BaseNode.tsx
const isHighlighted = selected ?? false;

// CustomEdge.tsx
const isHighlighted = selected ?? false;
```

This is the simplest path for visual feedback — ReactFlow handles all the click/drag-box mechanics, updates the store, and the component gets a prop. No extra subscriptions needed.

### 2. editorStore — Orchestration Layer

`editorStore` holds a centralized copy of the selection as ID arrays:

```typescript
selectedNodeIds: string[]
selectedEdgeIds: string[]
setSelection(nodeIds, edgeIds)
clearSelection()
```

This drives:
- **Config panel visibility** — CanvasLayout reads `selectedNodeIds`/`selectedEdgeIds` to decide which panel to show
- **Keyboard actions** — delete, copy, escape handlers read from editorStore
- **Programmatic selection** — sidebar clicks (diagnostics panel, variables panel) call `setSelection` directly
- **Debug mode** — cursor-on-click reads from editorStore

### Sync

ReactFlow's `onSelectionChange` callback fires whenever selection changes (click, drag-box, keyboard). CanvasLayout writes the result to editorStore:

```
User clicks node
    → ReactFlow updates node.selected internally
    → ReactFlow fires onSelectionChange({ nodes: [...], edges: [...] })
    → CanvasLayout extracts IDs → editorStore.setSelection(nodeIds, edgeIds)
```

Both layers update from the same event, staying in sync.

## Key Files

| File | Role |
|------|------|
| `src/visual-builder/store/editorStore.ts` | Orchestration selection state (`selectedNodeIds`, `selectedEdgeIds`) |
| `src/visual-builder/store/canvasStore.ts` | Raw store — ReactFlow writes `node.selected` here |
| `src/visual-builder/graph/BaseNode.tsx` | Reads `selected` prop for glow |
| `src/visual-builder/graph/CustomEdge.tsx` | Reads `selected` prop for glow |
| `src/visual-builder/CanvasLayout.tsx` | Bridges ReactFlow events → editorStore; reads editorStore for panels/keyboard |
| `src/visual-builder/CanvasArea.tsx` | Passes ReactFlow selection props (`onSelectionChange`, `onPaneClick`) |

## ReactFlow Selection Styling

ReactFlow's built-in `.selected` CSS outline is suppressed — we use custom SVG drop-shadow glow instead:

```css
.react-flow__node.selected,
.react-flow__edge.selected {
  outline: none !important;
}
```

## Why Two Layers?

A single source of truth would be ideal, but ReactFlow in controlled mode requires `node.selected` on the store objects for its internal mechanics (click handling, drag-box hit testing). We can't remove it. Rather than fighting ReactFlow, we let it manage the visual layer and use editorStore for everything else.
