# Graph Operations

## Overview

Graph operations are domain mutations on the canvas — adding, updating, deleting nodes and edges, connecting ports, copy/paste. All mutations flow through a single hook (`useGraph`) that enforces readOnly gating and undo/redo checkpointing.

## Architecture

```
              CanvasLayout / UI components
                        │
                    useGraph(canvasId, readOnly)
                  (readOnly gate + checkpoint)
                        │
                 graphOperations.ts
                   (pure functions)
                        │
                   canvasStore
               (setNodes, setEdges, ...)
                        ▲
                        │
                 CanvasArea / ReactFlow
           (selection, dimensions, position)
```

## Key Files

| File | Role |
|------|------|
| `src/visual-builder/hooks/useGraph.ts` | Public mutation API — readOnly gate + auto-checkpoint wrapper |
| `src/visual-builder/utils/graphOperations.ts` | Pure mutation functions — no React, no gating, no checkpointing |
| `src/visual-builder/store/canvasStore.ts` | Raw store — `setNodes`/`setEdges` used by ReactFlow directly |
| `src/visual-builder/CanvasArea.tsx` | ReactFlow integration — `onNodesChange`/`onEdgesChange` write to raw store |
| `src/visual-builder/CanvasLayout.tsx` | Orchestrates mutations via `useGraph` |

## useGraph — The Public API

All graph mutations go through `useGraph(canvasId, readOnly)`. The hook:

1. **Gates on readOnly** — if `readOnly` is true, every mutation no-ops. This is how preview mode and debug mode prevent edits without any store-level lock.
2. **Wraps in withCheckpoint** — every mutation automatically creates a single undo/redo history entry. Callers never need to manage checkpoints.

```typescript
const graph = useGraph(canvasId, readOnly);

graph.addNode(nodeDef, position);       // No-op if readOnly, checkpointed if not
graph.deleteSelected(nodeIds, edgeIds); // Batch delete = single undo entry
```

Exposed operations:
- `addNode`, `updateNode`, `deleteNode` — single node operations
- `deleteEdges` — edge deletion by ID array
- `deleteSelected(nodeIds, edgeIds)` — batch delete as single undo entry
- `onConnect` — validate and create an edge
- `updateEdge` — update edge data
- `copySelection` — read-only, no checkpoint needed
- `pasteSelection` — paste with new IDs

## graphOperations.ts — Pure Implementation

The actual mutation logic lives in `graphOperations.ts` as pure functions that receive a canvas store reference:

```typescript
addNodeToStore(store, nodeDef, position)
updateNodeInStore(store, nodeId, updates)
deleteNodeFromStore(store, nodeId, getNodeDefinition)
deleteEdgesFromStore(store, edgeIds)
connectNodesInStore(store, connection)
updateEdgeInStore(store, edgeId, updates)
pasteToStore(store, offset, getNodeDefinition)
```

These functions have **no readOnly checks and no checkpointing**. They are implementation details called by `useGraph`. They can also be called directly for non-interactive operations (e.g., migration scripts) that don't need undo history.

## canvasStore: setNodes / setEdges

**Important:** `setNodes` and `setEdges` on the canvas store are **unguarded raw setters**. They have no lock, no readOnly check, no checkpoint logic. This is intentional.

ReactFlow operates in controlled mode — it pushes state changes through `onNodesChange` → `setNodes` for:
- `"select"` changes (click/drag selection)
- `"dimensions"` changes (initial node measurement)
- `"position"` changes (node dragging — only when `nodesDraggable` is true)

If these setters were gated, ReactFlow's internal state would diverge from the controlled `nodes` prop, causing erratic click/selection behavior.

### Rule: Do NOT use setNodes/setEdges for domain mutations

`setNodes` and `setEdges` must not be used directly for graph operations (adding nodes, deleting edges, updating data). Always go through `useGraph`. The raw setters are not exported from `useGraph` — this is enforced by the hook's return type.

The only legitimate direct callers of `setNodes`/`setEdges` are:
- `CanvasArea.tsx` — ReactFlow's `onNodesChange`/`onEdgesChange` handlers
- `graphOperations.ts` — called indirectly via `useGraph`'s guarded wrapper
- Store internals — `initialize`, undo/redo history restoration
