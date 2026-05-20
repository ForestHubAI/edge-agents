# Save System

## Overview

The save system handles persisting project state, auto-saving, auto-versioning, and navigation guards. All save operations are gated on `builderMode` — only `"edit"` mode triggers saves. Preview and debug modes are fully inert from a persistence perspective.

## Key Files

| File | Role |
|------|------|
| `hooks/useAutoSave.ts` | Auto-save timers, dirty tracking, flush-on-unmount, store cleanup |
| `hooks/useAutoVersioning.ts` | Periodic version checkpoints (5 min interval) |
| `hooks/useNavigationGuard.ts` | Browser close/refresh warning for unsaved changes |
| `hooks/useProjectState.ts` | Hydration, preview mode transitions, version restore |
| `hooks/useWorkflowSerialization.ts` | Store-bound wrapper: calls the headless `serialize`/`deserialize` in `@foresthub/workflow-core/utils/workflowSerialization`, mediates Zustand I/O |
| `store/editorStore.ts` | `builderMode` — single source of truth for mode |

## One Serialization Format — the Contract Workflow

There is now a **single canonical persistence format**: the OpenAPI contract
`Schemas["Workflow"]` from `/contract/workflow.yaml`. The same format is used
for auto-save, manual save, version snapshots, code generation, and template
export/import. No more dual formats.

### Wire shape vs. in-memory shape

Two shapes coexist, but only one is persisted:

- **On wire** (persisted): `Schemas["Workflow"]` — contract-conformant JSON.
  Flat structure: main canvas data at the root, function canvases nested in
  `Workflow.functions[]`. This is what hits the backend / disk / network.
- **In memory** (transient): `WorkflowState` (in `@foresthub/workflow-core/utils/snapshots`) — convenient for the editor's React Flow runtime + the
  validator. Canvases keyed by id for O(1) lookup; node-output + fnarg
  variables precomputed; React-Flow-shape edges (`source/target/sourceHandle/targetHandle`).
  **Never serialized as-is.**

Pure converters live in `@foresthub/workflow-core/utils/workflowSerialization`:
```typescript
function serialize(state: WorkflowState): Schemas["Workflow"];   // memory → wire
function deserialize(workflow: Schemas["Workflow"]): WorkflowState; // wire → memory
```

The editor calls these via the `useWorkflowSerialization` hook (which adds
Zustand I/O and rekeys editor-specific prefixes). The CLI calls them directly
after `JSON.parse`.

### Permissive intermediate states

Auto-save needs to persist in-progress / incomplete workflows. The contract
schema was loosened (`/contract/workflow.yaml`): each node-type's `arguments`
inner object no longer requires every field. The schema's job is now
*parseability* — "does this JSON parse as a workflow object graph?". Semantic
correctness ("an agent has a model") is enforced by `validateWorkflowState`
in `@foresthub/workflow-core/utils/diagnostics`, not by the schema.

This separation lets the same JSON format serve both incomplete edits
(auto-save) and complete deployments (code generation). The validator
flags missing fields as diagnostics; the schema does not block the save.

## Builder Mode Gating

All save-related operations check `builderMode` before activating:

| Component | Gate | Effect |
|-----------|------|--------|
| `useAutoSave` | `builderMode.type !== "edit"` | Disables auto-save in preview/debug |
| `useAutoVersioning` | `builderMode.type !== "edit"` | Disables version checkpoints in preview/debug |
| `useNavigationGuard` | `isDraft \|\| isDirty \|\| isDebugActive` | Shows browser popup on close/refresh |
| Ctrl+S handler | `isReadOnly(mode)` | Blocks save in non-edit modes (except template -> opens save dialog) |
| `flushSave()` inner | `builderMode.type !== "edit"` | Re-checks mode at flush time (guards stale closures) |

## Auto-Save

`useAutoSave` persists the project automatically after changes, using a two-timer approach.

### Timer flow

1. Any canvas store change fires `onStoreChange()`
2. **Debounce timer** (500ms) — waits for the user to stop making rapid changes
3. **Save delay timer** (10s) — schedules the actual save

After the user stops editing, the save fires ~10.5 seconds later. Continuous editing keeps pushing the debounce.

### Change detection

On hydration, a baseline snapshot is captured as `lastSavedSnapshotRef`. Before each save, the current snapshot is JSON-stringified and compared. If identical, the save is skipped. This prevents unnecessary API calls when stores change without meaningful content changes (e.g., selection changes don't affect persisted fields since `exportSnapshot` strips them).

### Optimistic cache update

On save, the React Query cache is updated immediately:

```typescript
queryClient.setQueryData<Project[]>(projectKeys.all, (old) =>
  old?.map((p) =>
    p.id === projectId ? { ...p, name, description, content: snapshot } : p,
  ),
);
```

Navigating away and back shows the latest data instantly without a server round-trip.

### Save status indicators

The toolbar shows three states for saved projects:

| State | Visual | Tooltip |
|-------|--------|---------|
| Saving | Spinner (`Loader2` animate-spin) | "Saving..." |
| Unsaved changes | Amber dot (`bg-amber-500`) | "Unsaved changes" |
| Saved | Green check (`text-emerald-500`) | "Saved" |

For draft (never-saved) projects, a "Save" button is shown instead.

## Auto-Versioning

`useAutoVersioning` creates version checkpoints at a 5-minute interval when the project has changed. Same mode gate as auto-save (`builderMode.type !== "edit"`). Versions are created silently — no UI notification.

## Navigation Guard

`useNavigationGuard` attaches a `beforeunload` event listener that shows the browser's native "unsaved changes" popup. Activated when:

```typescript
useNavigationGuard(isDraft || isDirty || isDebugActive);
```

The Home button in the toolbar has its own guard — shows a `window.confirm` dialog in edit mode when draft or dirty, but skips in preview/debug modes (no changes to lose).

## Manual Save (Ctrl+S)

Ctrl+S behavior depends on the current mode:

| Mode | Ctrl+S behavior |
|------|----------------|
| Edit (draft) | Opens save dialog |
| Edit (saved) | `flushNow()` — immediate auto-save flush |
| View-template | Opens save dialog (pre-fills template name/description) |
| View-version | Blocked (nothing to save) |
| Debug | Blocked |

## Flush-on-Unmount

When the user navigates away from the builder, the `useAutoSave` effect cleanup runs:

```
cancel timers -> flushSave() -> clearAllCanvasStores()
```

**Ordering guarantee:** Both operations live in the same effect cleanup so save-before-clear is guaranteed (React doesn't guarantee ordering across different effects).

## Hydration

Hydration loads persisted project data into Zustand stores on mount, managed by `useProjectState`.

### Flow

1. `Builder.tsx` loads `Project` from React Query cache
2. `useProjectState` runs an effect on `[project.id]`:
   - Resets to `builderMode: { type: "edit" }` (clears any leftover preview mode)
   - Calls `importSnapshot(project.content)` — clears stores, hydrates from snapshot
   - Clears undo history on active canvas
   - Sets `isHydrated = true`
3. `useAutoSave` captures baseline snapshot only after `isHydrated` flips — prevents empty state from overwriting persisted data

### New projects

No `projectId` -> `isHydrated` set immediately with no import -> empty main canvas.

## Preview Mode Transitions

Preview modes temporarily replace the canvas content while preserving the ability to restore the original state.

### View Version

1. Save current state: snapshot + undo/redo history + tab state
2. Load version snapshot into stores
3. Clear undo history (preview starts fresh)
4. Set `builderMode: { type: "view-version", originalSnapshot, originalHistory, ... }`
5. Auto-save and auto-versioning become inert (mode gate)

### Cancel Preview

1. Set `builderMode: { type: "edit" }` — **must happen before import** (otherwise the import triggers auto-save of the preview state)
2. Restore original snapshot
3. Restore undo/redo history

### Restore From Preview

1. Persist version via API (`restoreVersion`)
2. Set `builderMode: { type: "edit" }`
3. Clear undo history (new baseline)
4. `flushNow()` ensures backend and React Query cache are in sync

### Template Preview

Templates enter `view-template` mode after import. "Use as Project" pre-fills name/description and opens save dialog. Preview exits automatically when save succeeds (navigation remounts VisualBuilder).

## Store Lifecycle

### Lazy initialization

Canvas stores are created lazily via `getOrCreateCanvasStore(canvasId)`. The main canvas store is created at module load time. Function canvas stores are created on demand — either during import/hydration or when a user creates a new function.

### Cleanup

`clearAllCanvasStores()` deletes all entries from the module-level `Map`, including the main canvas. Called on unmount (after flush-save) and at the start of `importSnapshot()`/`importProject()`.

## Save/Load Lifecycle

```
┌─ LOAD ───────────────────────────────────────────────────┐
│                                                          │
│  Builder.tsx                                             │
│    ↓ Project from React Query cache                      │
│  useProjectState                                         │
│    ↓ setBuilderMode({ type: "edit" })                    │
│    ↓ importSnapshot(project.content)                     │
│  clearAllCanvasStores() + hydrate                        │
│    ↓                                                     │
│  isHydrated = true                                       │
│    ↓                                                     │
│  useAutoSave captures baseline snapshot                  │
│                                                          │
└──────────────────────────────────────────────────────────┘

┌─ SAVE (auto) ────────────────────────────────────────────┐
│                                                          │
│  Store change detected (subscription)                    │
│    ↓ gate: builderMode.type === "edit" ?                 │
│    ↓ 500ms debounce                                      │
│  Schedule save                                           │
│    ↓ 10s delay                                           │
│  exportSnapshot() → JSON.stringify → compare             │
│    ↓ (skip if unchanged)                                 │
│  Update React Query cache (optimistic)                   │
│  PUT /projects/{projectId} (fire-and-forget)             │
│                                                          │
└──────────────────────────────────────────────────────────┘

┌─ UNMOUNT ────────────────────────────────────────────────┐
│                                                          │
│  useAutoSave cleanup effect                              │
│    ↓ cancel timers                                       │
│    ↓ flushSave() — immediate save if changes pending     │
│    ↓ clearAllCanvasStores()                              │
│                                                          │
└──────────────────────────────────────────────────────────┘
```
