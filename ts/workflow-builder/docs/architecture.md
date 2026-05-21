# Workflow Builder - Detailed Architecture

> This document is the detailed reference for the workflow-builder system.
> Referenced from CLAUDE.md via `@docs/workflow-builder/architecture.md`.

## Key Components and Their Responsibilities

### Main Entry Point
- **[VisualBuilder.tsx](src/workflow-builder/VisualBuilder.tsx)**: Root component that orchestrates all functionality
  - Initializes all hooks (agent state, canvas tabs, functions, code generation)
  - Manages dialogs (import/export, versions, testing)
  - Handles project saving and loading
  - Lazy loads heavy dialog components for performance

### Layout Components
- **[CanvasLayout.tsx](src/workflow-builder/CanvasLayout.tsx)**: Main layout orchestrator
  - Manages canvas-specific hooks (useCanvasManagement, useSelection)
  - Coordinates toolbar, sidebar, canvas area, and config panels
  - Handles keyboard events for delete/undo/redo
  - Switches between function canvas and main canvas modes
  - Shows NodeConfigPanel or FunctionDefinitionPanel based on context

- **[CanvasArea.tsx](src/workflow-builder/CanvasArea.tsx)**: ReactFlow canvas wrapper
  - Integrates ReactFlow for node editing
  - Handles drag-and-drop from NodeLibrary
  - Connects directly to canvas stores
  - Manages node/edge changes via ReactFlow
  - Custom node/edge types with validation

### Sidebar Panels
- **[BuilderSidebar.tsx](src/workflow-builder/panels/BuilderSidebar.tsx)**: Left sidebar with tab navigation
  - 5 tabs: Nodes, Functions, Variables, Agents, Conversations
  - Icon rail always visible, content panel slides in/out
  - Routes to appropriate panel based on active tab

- **[NodeLibrary.tsx](src/workflow-builder/panels/NodeLibrary.tsx)**: Node palette with drag-and-drop
  - Categorized node browser with search
  - Shows node parameters and descriptions
  - Drag-to-canvas or click-to-add functionality
  - Dynamic inclusion of function nodes

- **[FunctionsPanel.tsx](src/workflow-builder/panels/FunctionsPanel.tsx)**: Function management
  - Create/delete/open custom functions
  - Shows function I/O port counts
  - Active function highlighting
  - Delete confirmation dialog

- **[VariablesPanel.tsx](src/workflow-builder/panels/VariablesPanel.tsx)**: Variable inspection and navigation

### Configuration Panels
- **[NodeConfigPanel.tsx](src/workflow-builder/panels/NodeConfigPanel.tsx)**: Right panel for node configuration
  - Opens when single node is click-selected
  - Parameter editors for each node parameter
  - Node deletion (except structural nodes)
  - Special "Test Agent" button for Agent nodes

- **[FunctionDefinitionPanel.tsx](src/workflow-builder/panels/FunctionDefinitionPanel.tsx)**: Right panel for function canvases
  - Define function inputs/outputs
  - Add/remove/edit ports with name and dataType
  - Only visible when on a function canvas

### Node Visualization
- **[CustomNode.tsx](src/workflow-builder/graph/CustomNode.tsx)**: Visual node component
  - SVG-based rendering with multiple shapes (rectangle, tapered-right for triggers)
  - Color-coded by category (Agent, Tool, Trigger, etc.)
  - Shows parameters inline (up to 3)
  - Port handles for control and tool connections
  - Warning badges for invalid parameters or unconnected inputs
  - Dynamic port positioning (execution on sides, tool on top/bottom)
  - Expression validation and visual feedback

- **[CustomEdge.tsx](src/workflow-builder/graph/CustomEdge.tsx)**: Custom edge rendering
- **[PortHandle.tsx](src/workflow-builder/graph/PortHandle.tsx)**: Connection port visualization

### Input Components
- **[ParameterEditor.tsx](src/workflow-builder/inputs/ParameterEditor.tsx)**: Multi-type parameter editor
- **[ExpressionInput.tsx](src/workflow-builder/inputs/ExpressionInput.tsx)**: Expression editor with variable references

### Dialogs
- **[ImportExportDialogs.tsx](src/workflow-builder/dialogs/ImportExportDialogs.tsx)**: JSON import/export, save dialog
- **[AgentTestDialog.tsx](src/workflow-builder/dialogs/AgentTestDialog.tsx)**: Testing interface for agent nodes

---

## Store Architecture

The system uses **two independent Zustand stores** with different responsibilities:

### [canvasStore.ts](src/workflow-builder/store/canvasStore.ts) - Multi-Instance Canvas State
**Architecture**: Registry pattern with independent store instances

```typescript
// Module-level registry
const canvasStores = new Map<string, CanvasStore>();
```

**Features:**
- One store instance per canvas (main + each function)
- Each store is a Zustand store + history (undo/redo) middleware
- Stores nodes, edges, variables, functionInfo, and outputAssignments
- Independent undo/redo history per canvas (50 frames limit)
- CRUD operations: `setNodes`, `setEdges`, `setVariables`, `setFunctionInfo`, `setOutputAssignments`, `initialize`
- `OutputAssignments` type alias (`Record<string, Expression>`) defined here, maps return variable uid → Expression

**Key Methods:**
- `getCanvasStore(id)`: Get existing store
- `getOrCreateCanvasStore(id)`: Get or create store
- `deleteCanvasStore(id)`: Remove function canvas store
- `clearAllCanvasStores()`: Reset all stores (on import)

**History Management:**
- `takeSnapshot()`: Manual checkpoint before mutations
- `undo()` / `redo()`: Time travel through history
- `canUndo()` / `canRedo()`: Check if possible
- `clearHistory()`: Reset history on load

### editorStore.ts - Global Editor State
**Purpose**: Cross-canvas state — things that are not scoped to a single canvas store.

**State:**
```typescript
{
  activeCanvasId: string,                     // Currently focused canvas (main or a function)
  builderMode: BuilderMode,                   // { type: "edit" } | { type: "preview", ... } | { type: "debug" }
  selectedNodeIds: string[],                  // Current selection (mirrored for cross-canvas readers)
  selectedEdgeIds: string[],
  channels: Record<string, ChannelInstance>, // Project-scoped pins/buses, shared across canvases
}
```

**Note:** `FunctionInfo` is the source of truth per function and lives in `canvasStore.functionInfo` on each function canvas. `editorStore` does not mirror it. Use `isReadOnly(builderMode)` / `isPreview(builderMode)` guards from `editorStore.ts` when reading mode.

### [history.ts](src/workflow-builder/utils/history.ts) - Undo/Redo Middleware
- Manual snapshot system (not automatic)
- Stores history frames with timestamps
- Partialize function to select trackable state
- History limit configuration
- Separate past/future arrays for time travel

### [diagnosticsStore.ts](src/workflow-builder/store/diagnosticsStore.ts) - Flat Diagnostics State
- Holds diagnostics (errors/warnings) for the currently active canvas only
- Intentionally flat (no per-canvas nesting) — only one canvas rendered at a time
- Diagnostics written via `useEffect` in BaseNode/CustomEdge with cleanup-on-unmount
- `validateAllCanvases()` in `utils/diagnostics.ts` runs full-project validation on-demand
- See [docs/diagnostics.md](docs/diagnostics.md) for full lifecycle documentation

---

## Hook Patterns

The system uses **custom hooks as domain logic orchestrators**:

### Canvas Management
**[useGraph(canvasId)](src/workflow-builder/hooks/useGraph.ts)** - Node CRUD and history
- Gets specific canvas store instance
- Business logic: `addNode`, `updateNode`, `deleteNode`/`deleteNodes`, `onConnect`
- History operations: `undo`, `redo`, `takeSnapshot`
- **Pattern**: Hook receives canvas ID, binds to specific store

### Selection Management
**useSelection(options)** - Local selection state
- Tracks selected nodes/edges, manages config panel visibility
- Distinguishes click vs drag selection (only click shows config)
- Keyboard handlers (Delete, Escape, Undo/Redo)
- **Pattern**: Local state + callbacks to parent

### Canvas Tabs
**useCanvasTabs()** - Tab UI coordination
- Syncs with editorStore.activeCanvasId
- CRUD operations: `openTab`, `closeTab`, `removeTab`
- **Pattern**: Local UI + global store sync

### Functions
**useFunctions(options)** - Function lifecycle management
- Coordinates store, tabs, and canvas concerns
- `addFunction`, `deleteFunction`, `updateFunctionDefinition`
- **Pattern**: Cross-cutting orchestration

### Node Definitions
**useNodeDefinitions()** - Dynamic node registry
- Combines static nodes (NodeRegistry) + dynamic function nodes
- `buildFunctionNodeDef(fn)`: Builds `FunctionNodeDefinition` from `FunctionInfo`
- **Pattern**: Derived state from function registry

### Import/Export
**useImportExport()** - Serialization bridge
- Bidirectional conversion: Zustand stores ↔ API Project format
- **Pattern**: Store access layer

### Agent State
**useAgentState(project)** - Project-level state
- Agent metadata, version history, hydration tracking
- `getSerializedConfig()` is a getter, not reactive (pull-based)

### Code Generation
**useCodeGeneration()** - Backend integration
- Exports project → calls ForestHub API → downloads ZIP
- **Pattern**: Effect-based external API

---

## UI Component Interaction Flow

### Left-to-Right Flow:
1. **BuilderSidebar (Left)** → User selects tab → content panel slides in
2. **NodeLibrary Panel** → Drag node to canvas or click to add
3. **CanvasArea (Center)** → ReactFlow renders nodes → events → `useCanvasManagement` → store
4. **NodeConfigPanel (Right)** → Opens on click-select → parameter editing → `updateNode`
5. **FunctionDefinitionPanel (Right, alternative)** → Only on function canvases

### Canvas Switching:
FunctionsPanel click → `useFunctions.openFunction` → `editorStore.activeCanvasId` → `useCanvasTabs` syncs → `CanvasLayout` remounts via `key={activeTabId}`

### Undo/Redo Flow:
`takeSnapshot()` BEFORE mutation → mutation updates store → Ctrl+Z → `undo()` → restore previous state → selection cleared

---

## Type Definitions

### Type Hierarchy
All domain types from API schema, re-exported from `@/node`:
- `Variable`, `DataType`, `Expression`, `Reference`, `FunctionInfo` — from `@/node`
- `ResolvedExpr` — UI-specific, in `utils/expressions/types.ts`
- `OutputAssignments` (`Record<string, Expression>`) — in `store/canvasStore.ts`

### Core Node Types
```typescript
NodeBase {
  id: string,
  type: NodeType,
  arguments: Record<string, unknown>,
  output: Variable[],
}

FunctionCallNode extends NodeBase {
  type: "FunctionCall",
  functionInfo: FunctionInfo,  // Snapshot for staleness detection
  arguments: {
    inputBindings: Record<string, Expression>,
    outputNames: Record<string, string>,
  },
}
```

### Domain Types
```typescript
Variable { name: string, dataType: DataType }
Expression { expression: string, references: Reference[], dataType: DataType }
Reference { nodeId: string, outputId: string }
FunctionInfo { id: string, version: number, name: string, arguments: Variable[], returns: Variable[] }
```

---

## Architectural Decisions

1. **Multi-Store**: Separate canvas store per function — independent undo/redo, no cross-canvas pollution
2. **Manual Snapshots**: `takeSnapshot()` before mutations — fine-grained history, batch operations create single entry
3. **Hook-Based Logic**: Business logic in hooks, not stores — stores stay simple, hooks compose
4. **Remounting on Canvas Switch**: `key={activeTabId}` forces fresh hooks, prevents stale closures
5. **Expression Type Checking**: Custom parser with C-style rules, jsep for AST, validates before codegen
6. **Reference Propagation**: Output changes propagate to all referencing nodes, stale references invalidated on delete
7. **Port Validation**: Control ports single outgoing (except Agent), tool ports allow multiple, same-type only
8. **Dynamic Node Definitions**: `buildFunctionNodeDef()` makes functions first-class nodes in NodeLibrary
9. **Selection as Local State**: UI concern, not domain state — different canvases have different selections
10. **Lazy Dialog Loading**: `lazy()` + `Suspense` — reduce initial bundle, load on demand
11. **Read-Only Serialization**: `getSerializedConfig()` is pull-based, not reactive — avoids unnecessary re-renders
12. **Port Positioning**: Control on sides (L/R = horizontal flow), tool on top/bottom (vertical connections)
13. **FunctionCallNode Self-Contained**: Stores `functionInfo` snapshot, staleness detection via version comparison
14. **Nested Arguments Routing**: `mergeFunctionCallArguments()` routes `out_*` → `outputNames`, others → `inputBindings`
15. **Render-Based Diagnostics**: `useEffect` with cleanup-on-unmount, flat store, pure functions for on-demand validation
