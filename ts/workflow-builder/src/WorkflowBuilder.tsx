import type { Schemas } from "@foresthub/workflow-core";
import type { Workflow } from "@foresthub/workflow-core/workflow";
import { validateWorkflowState, type ValidationResult } from "@foresthub/workflow-core/diagnostics";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { BuilderLayout } from "./BuilderLayout";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/toaster";
import { useCanvasTabs } from "./hooks/useCanvasTabs";
import { useChannelDiagnosticsSync } from "./hooks/useChannelDiagnosticsSync";
import { useFunctions } from "./hooks/useFunctions";
import { useMemoryDiagnosticsSync } from "./hooks/useMemoryDiagnosticsSync";
import { useWorkflowSerialization, readStateFromStores } from "./hooks/useWorkflowSerialization";
import {
  clearAllCanvasStores,
  getAllCanvasStores,
  getOrCreateCanvasStore,
  subscribeFunctionInfoChanges,
  type CanvasStore,
} from "./store/canvasStore";
import { useDebugStore, type DebugSessionPhase } from "./store/debugStore";
import { useEditorStore } from "./store/editorStore";

/** BuilderMode steers the overall behavior of the workflow builder. */
export type BuilderMode =
  | { type: "edit" }
  | { type: "preview" }
  | { type: "debug" };

/** True when canvas mutations should be blocked (preview or debug). */
export function isReadOnly(mode: BuilderMode): boolean {
  return mode.type !== "edit";
}

// TODO: remove?
/** Type guard for preview mode. */
export function isPreview(mode: BuilderMode): mode is Extract<BuilderMode, { type: "preview" }> {
  return mode.type === "preview";
}

// ============================================================================
// Public contract
// ============================================================================

export interface WorkflowBuilderProps {
  // ── Initial state (one-shot; subsequent updates go through the handle) ──
  /** Workflow loaded on mount. */
  initialWorkflow?: Workflow;
  /** Builder mode on mount. Defaults to { type: "edit" }. */
  initialMode?: BuilderMode;

  // ── Embedder-fulfilled actions (builder asks, embedder does) ──
  /** A node requested embedder-side testing (e.g. Agent "Test" button). */
  onTestNode?: (nodeId: string) => void;
  /** Step request from the in-builder debug panel — embedder forwards to the engine. */
  onDebugStep?: (nodeId?: string, externalState?: Schemas["DebugExternalState"]) => void;

  // ── Lifecycle events ──
  /** Fires after any save-worthy mutation. Pull current state via handle.exportWorkflow(). */
  onChange?: () => void;
  /** Selection changed (nodes/edges on the active canvas). */
  onSelectionChange?: (selection: { nodeIds: string[]; edgeIds: string[] }) => void;
  /** Unexpected error during builder operations (e.g. failed load). */
  onError?: (error: Error) => void;
}

export interface WorkflowBuilderHandle {
  // State I/O
  loadWorkflow: (workflow: Workflow) => void;
  exportWorkflow: () => Workflow;
  clear: () => void;

  // Mode (replaces preview/debug entry-point props)
  setMode: (mode: BuilderMode) => void;
  getMode: () => BuilderMode;

  // Validation (embedder renders its own dialog from the result)
  validate: () => ValidationResult;

  // History (so embedder chrome can wire undo/redo buttons)
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Selection
  selectNodes: (nodeIds: string[]) => void;
  selectEdges: (edgeIds: string[]) => void;
  clearSelection: () => void;

  // Debug (embedder pushes engine events for visualization)
  setDebugPhase: (phase: DebugSessionPhase) => void;
}

// ============================================================================
// Component — owns tabs/functions/dialogs; exposes the handle; delegates
// layout/canvas rendering to BuilderLayout.
// ============================================================================

export const WorkflowBuilder = forwardRef<WorkflowBuilderHandle, WorkflowBuilderProps>(
  function WorkflowBuilder(props, ref) {
    const {
      initialWorkflow,
      initialMode,
      onTestNode,
      onDebugStep,
      onChange,
      onSelectionChange,
      onError,
    } = props;

    const { importProject, exportProject } = useWorkflowSerialization();

    // Keep project-scoped (channel + memory) diagnostics in sync. Mounted once
    // here at the root so badges survive sidebar tab open/close.
    useChannelDiagnosticsSync();
    useMemoryDiagnosticsSync();

    // Canvas tabs + functions live here because they survive canvas switches.
    const canvasTabs = useCanvasTabs();
    const functionsHook = useFunctions({
      onOpenTab: canvasTabs.openTab,
      onRemoveTab: canvasTabs.removeTab,
      onRenameTab: canvasTabs.renameTab,
    });

    // Initial load (runs once, even under StrictMode double-mount).
    const initialLoadDone = useRef(false);
    useEffect(() => {
      if (initialLoadDone.current) return;
      initialLoadDone.current = true;
      try {
        if (initialMode) useEditorStore.getState().setBuilderMode(initialMode);
        if (initialWorkflow) importProject(initialWorkflow);
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Lifecycle subscriptions ────────────────────────────────────────────
    // Stash latest callbacks in refs so the subscription effect runs once.
    const onChangeRef = useRef(onChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    onChangeRef.current = onChange;
    onSelectionChangeRef.current = onSelectionChange;

    // onChange fires on any domain mutation. We subscribe to canvasStore
    // mutationCount (bumped only on real mutations, not selection) so
    // selection changes don't trigger save-worthy events.
    useEffect(() => {
      const subs: Array<() => void> = [];
      const subscribedStores = new WeakSet<CanvasStore>();

      function subscribeCanvas(store: CanvasStore) {
        if (subscribedStores.has(store)) return;
        subscribedStores.add(store);
        let prev = store.getState().mutationCount;
        const unsub = store.subscribe((state) => {
          if (state.mutationCount !== prev) {
            prev = state.mutationCount;
            onChangeRef.current?.();
          }
        });
        subs.push(unsub);
      }

      function subscribeAllCanvases() {
        for (const store of Object.values(getAllCanvasStores())) {
          subscribeCanvas(store);
        }
      }

      subscribeAllCanvases();

      // Canvas stores come and go (function add/delete, project load).
      const unsubRegistry = subscribeFunctionInfoChanges(subscribeAllCanvases);
      subs.push(unsubRegistry);

      // Project-scoped mutations (channels, memory files).
      let prevEditorCount = useEditorStore.getState().mutationCount;
      const unsubEditor = useEditorStore.subscribe((state) => {
        if (state.mutationCount !== prevEditorCount) {
          prevEditorCount = state.mutationCount;
          onChangeRef.current?.();
        }
      });
      subs.push(unsubEditor);

      return () => {
        for (const u of subs) u();
      };
    }, []);

    // Selection subscription.
    useEffect(() => {
      let prevNodes = useEditorStore.getState().selectedNodeIds;
      let prevEdges = useEditorStore.getState().selectedEdgeIds;
      return useEditorStore.subscribe((state) => {
        if (state.selectedNodeIds !== prevNodes || state.selectedEdgeIds !== prevEdges) {
          prevNodes = state.selectedNodeIds;
          prevEdges = state.selectedEdgeIds;
          onSelectionChangeRef.current?.({
            nodeIds: state.selectedNodeIds,
            edgeIds: state.selectedEdgeIds,
          });
        }
      });
    }, []);

    // ── Imperative handle ─────────────────────────────────────────────────
    useImperativeHandle(
      ref,
      (): WorkflowBuilderHandle => ({
        loadWorkflow: (workflow) => {
          try {
            importProject(workflow);
          } catch (e) {
            onError?.(e instanceof Error ? e : new Error(String(e)));
          }
        },
        exportWorkflow: () => exportProject(),
        clear: () => {
          clearAllCanvasStores();
          useEditorStore.getState().clearSelection();
        },
        setMode: (mode) => useEditorStore.getState().setBuilderMode(mode),
        getMode: () => useEditorStore.getState().builderMode,
        validate: () => validateWorkflowState(readStateFromStores()),
        undo: () => getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).undo(),
        redo: () => getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).redo(),
        canUndo: () =>
          getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).canUndo(),
        canRedo: () =>
          getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).canRedo(),
        selectNodes: (nodeIds) => {
          useEditorStore.getState().setSelection(nodeIds, []);
          const canvasId = useEditorStore.getState().activeCanvasId;
          getOrCreateCanvasStore(canvasId).getState().selectNodes(nodeIds);
        },
        selectEdges: (edgeIds) => {
          useEditorStore.getState().setSelection([], edgeIds);
          const canvasId = useEditorStore.getState().activeCanvasId;
          getOrCreateCanvasStore(canvasId).getState().selectEdges(edgeIds);
        },
        clearSelection: () => {
          useEditorStore.getState().clearSelection();
          const canvasId = useEditorStore.getState().activeCanvasId;
          const store = getOrCreateCanvasStore(canvasId).getState();
          store.selectNodes([]);
          store.selectEdges([]);
        },
        setDebugPhase: (phase) => useDebugStore.getState().setPhase(phase),
      }),
      [importProject, exportProject, onError],
    );

    // TooltipProvider + Toaster live inside the package so the embedder
    // doesn't need to know we use Radix tooltips or shadcn toasts internally.
    return (
      <TooltipProvider delayDuration={300}>
        <BuilderLayout
          functions={functionsHook.functions}
          onOpenFunction={functionsHook.openFunction}
          onCreateFunction={functionsHook.addFunction}
          onDeleteFunction={functionsHook.deleteFunction}
          onRenameFunction={functionsHook.renameFunction}
          canvasTabs={canvasTabs.tabs}
          onCanvasTabChange={canvasTabs.setActiveTabId}
          onCanvasTabClose={canvasTabs.closeTab}
          onCanvasTabReorder={canvasTabs.reorderTabs}
          onTestNode={onTestNode}
          onDebugStep={onDebugStep}
        />
        <Toaster />
      </TooltipProvider>
    );
  },
);
