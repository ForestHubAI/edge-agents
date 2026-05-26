import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";
import type { ModelInfo } from "@foresthubai/workflow-core/model";
import {
  validateWorkflowState,
  validateChannel,
  validateMemory,
  validateModel,
  type Diagnostic,
  type ValidationResult,
} from "@foresthubai/workflow-core/diagnostics";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";

import i18n from "./i18n";
import { toast } from "./hooks/use-toast";
import ValidationDialog from "./dialogs/ValidationDialog";
import { BuilderLayout } from "./BuilderLayout";
import { TooltipProvider } from "./components/ui/tooltip";
import { Toaster } from "./components/ui/toaster";
import { useCanvasTabs } from "./hooks/useCanvasTabs";
import { useResourceDiagnosticsSync } from "./hooks/useResourceDiagnosticsSync";
import { useSuppressThemeTransition } from "./hooks/useSuppressThemeTransition";
import { useFunctions } from "./hooks/useFunctions";
import { useWorkflowSerialization, readStateFromStores } from "./hooks/useWorkflowSerialization";
import {
  clearAllCanvasStores,
  getAllCanvasStores,
  getOrCreateCanvasStore,
  subscribeFunctionInfoChanges,
  MAIN_CANVAS_ID,
  type CanvasStore,
} from "./stores/canvasStore";
import { useDebugStore, type DebugSessionPhase } from "./stores/debugStore";
import { useEditorStore } from "./stores/editorStore";

/** BuilderMode steers the overall behavior of the workflow builder. */
export type BuilderMode = { type: "edit" } | { type: "preview" } | { type: "debug" };

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
  /** Workflow loaded on mount. */
  initialWorkflow?: ApiWorkflow;
  /** Builder mode on mount. Defaults to { type: "edit" }. */
  initialMode?: BuilderMode;
  /**
   * Static model catalog — the models the llmproxy supports. Shown as the
   * built-in options in agent model pickers. Self-hosted/custom models are
   * declared in the Models tab instead. Defaults to [] (empty dropdown).
   */
  models?: ModelInfo[];
  /**
   * UI language (e.g. "en", "de"). The host owns locale; the builder follows.
   * Defaults to "en". The builder never auto-detects language.
   */
  language?: string;

  // ── Embedder-fulfilled actions (builder asks, embedder does) ──
  /** A node requested embedder-side testing (e.g. Agent "Test" button). */
  onTestNode?: (nodeId: string) => void;
  /** Step request from the in-builder debug panel — embedder forwards to the engine. */
  onDebugStep?: (nodeId?: string) => void;

  // ── Lifecycle events ──
  /** Fires after any domain-state mutation. Pull current state via handle.exportWorkflow(). */
  onChange?: () => void;
  /**
   * Undo/redo availability for the ACTIVE canvas changed — on history mutation,
   * undo/redo, or a tab switch (each canvas has its own history). For wiring host
   * undo/redo buttons.
   */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  /** Selection changed (nodes/edges on the active canvas). */
  onSelectionChange?: (selection: { nodeIds: string[]; edgeIds: string[] }) => void;
  /** Unexpected error during builder operations (e.g. failed load). */
  onError?: (error: Error) => void;
}

export interface WorkflowBuilderHandle {
  // State I/O
  loadWorkflow: (workflow: ApiWorkflow) => void;
  exportWorkflow: () => ApiWorkflow;
  clear: () => void;

  // Mode (replaces preview/debug entry-point props)
  setMode: (mode: BuilderMode) => void;
  getMode: () => BuilderMode;

  // Validation — runs the validator and presents the result itself: a success
  // toast when clean, otherwise the builder's ValidationDialog (whose entries are
  // clickable to navigate to the offending node/edge/resource).
  validate: () => void;

  // History (so embedder chrome can wire undo/redo buttons)
  undo: () => void;
  redo: () => void;

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
      models,
      language,
      onTestNode,
      onDebugStep,
      onChange,
      onHistoryChange,
      onSelectionChange,
      onError,
    } = props;

    // Host drives locale. useLayoutEffect (not useEffect) so the language is set
    // before paint — mounting with language="de" shows German on the first frame
    // rather than flashing English. changeLanguage is sync here (bundled resources).
    useLayoutEffect(() => {
      if (language && i18n.language !== language) i18n.changeLanguage(language);
    }, [language]);

    const { importProject, exportProject } = useWorkflowSerialization();

    // Color-mode toggles should snap, not fade — see hook docs.
    useSuppressThemeTransition();

    // Keep project-scoped (channel + memory + model) diagnostics in sync. Mounted
    // once here at the root so badges survive sidebar tab open/close.
    useResourceDiagnosticsSync({
      selectItems: (s) => s.channels,
      validate: validateChannel,
      getStored: (d) => d.byChannelId,
      set: (d, id, diags) => d.setChannelDiagnostics(id, diags),
      clear: (d, id) => d.clearChannelDiagnostics(id),
    });
    useResourceDiagnosticsSync({
      selectItems: (s) => s.memory,
      validate: validateMemory,
      getStored: (d) => d.byMemoryId,
      set: (d, id, diags) => d.setMemoryDiagnostics(id, diags),
      clear: (d, id) => d.clearMemoryDiagnostics(id),
    });
    useResourceDiagnosticsSync({
      selectItems: (s) => s.models,
      validate: validateModel,
      getStored: (d) => d.byModelId,
      set: (d, id, diags) => d.setModelDiagnostics(id, diags),
      clear: (d, id) => d.clearModelDiagnostics(id),
    });

    // Push the embedder-supplied model catalog into the store so agent model
    // pickers can read it. Catalog is config (not workflow content), so this
    // never fires onChange.
    useEffect(() => {
      useEditorStore.getState().setAvailableModels(models ?? []);
    }, [models]);

    // Canvas tabs + functions live here because they survive canvas switches.
    const canvasTabs = useCanvasTabs();
    const functionsHook = useFunctions({
      onOpenTab: canvasTabs.openTab,
      onRemoveTab: canvasTabs.removeTab,
      onRenameTab: canvasTabs.renameTab,
    });

    // Built-in validation UX. validate() presents the result itself rather than
    // returning it: a success toast when clean, else this dialog. Non-null = open.
    const [validation, setValidation] = useState<ValidationResult | null>(null);

    const runValidate = useCallback(() => {
      const result = validateWorkflowState(readStateFromStores());
      if (result.totalErrors === 0 && result.totalWarnings === 0) {
        toast({ title: i18n.t("validationPassed") });
      } else {
        setValidation(result);
      }
    }, []);

    // Jump to a diagnostic's target, then dismiss the dialog so it's visible.
    const navigateToDiagnostic = useCallback(
      (d: Diagnostic) => {
        const editor = useEditorStore.getState();
        // Project-scoped targets: open the matching sidebar tab AND select the item.
        if (d.channelId) {
          editor.setActiveSidebarTab("channels");
          editor.setSelectedChannelId(d.channelId);
        } else if (d.memoryId) {
          editor.setActiveSidebarTab("memory");
          editor.setSelectedMemoryId(d.memoryId);
        } else if (d.modelId) {
          editor.setActiveSidebarTab("models");
          editor.setSelectedModelId(d.modelId);
        } else if (d.canvasId) {
          if (d.canvasId === MAIN_CANVAS_ID) editor.setActiveCanvas(MAIN_CANVAS_ID);
          else functionsHook.openFunction(d.canvasId);
          if (d.nodeId) {
            editor.setSelection([d.nodeId], []);
            getOrCreateCanvasStore(d.canvasId).getState().selectNodes([d.nodeId]);
          } else if (d.edgeId) {
            editor.setSelection([], [d.edgeId]);
            getOrCreateCanvasStore(d.canvasId).getState().selectEdges([d.edgeId]);
          }
        }
        setValidation(null);
      },
      [functionsHook],
    );

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
    const onHistoryChangeRef = useRef(onHistoryChange);
    const onSelectionChangeRef = useRef(onSelectionChange);
    onChangeRef.current = onChange;
    onHistoryChangeRef.current = onHistoryChange;
    onSelectionChangeRef.current = onSelectionChange;

    // onChange fires on any domain change. For canvas content we watch the
    // history middleware's `mutationCount`, which bumps on checkpoints AND
    // undo/redo but never on selection/drag (those go through setNodes without a
    // checkpoint). That makes onChange honest for undo/redo and silent on
    // view-state — the thing a raw store subscription can't do, since selection
    // lives inside the nodes array. (editorStore exposes its own `mutationCount`
    // for project-scoped channel/memory/model edits; watched separately below.)
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

      // Canvas stores come and go (function add/delete/rename, project load).
      // Re-subscribe to the new set AND fire onChange: adding, removing or
      // renaming a function changes the exported workflow, so it's a domain
      // mutation in its own right (it doesn't pass through any canvas checkpoint).
      // Loads also notify here, but the host guards those via its loading flag.
      const unsubRegistry = subscribeFunctionInfoChanges(() => {
        subscribeAllCanvases();
        onChangeRef.current?.();
      });
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

    // History-affordance subscription — emits the ACTIVE canvas's canUndo/canRedo
    // so host chrome can drive undo/redo buttons. Distinct from onChange: a tab
    // switch changes which history is active without being a domain mutation, so
    // it must update buttons without marking the document dirty.
    useEffect(() => {
      let prevCanUndo: boolean | null = null;
      let prevCanRedo: boolean | null = null;
      let unsubActive: (() => void) | null = null;

      const emit = () => {
        const store = getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId);
        const canUndo = store.canUndo();
        const canRedo = store.canRedo();
        if (canUndo === prevCanUndo && canRedo === prevCanRedo) return;
        prevCanUndo = canUndo;
        prevCanRedo = canRedo;
        onHistoryChangeRef.current?.({ canUndo, canRedo });
      };

      // Bind to the current active canvas (a) and emit. Re-run on tab switch (b)
      // and on store-instance rebuilds from load/clear (c) — both can change which
      // store, or store object, is active under us.
      const bindActive = () => {
        unsubActive?.();
        unsubActive = getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).subscribe(emit);
        emit();
      };

      bindActive();

      let prevActive = useEditorStore.getState().activeCanvasId;
      const unsubEditor = useEditorStore.subscribe((state) => {
        if (state.activeCanvasId !== prevActive) {
          prevActive = state.activeCanvasId;
          bindActive(); // (b) tab switch
        }
      });
      const unsubRegistry = subscribeFunctionInfoChanges(bindActive); // (c) load/clear rebuild

      return () => {
        unsubActive?.();
        unsubEditor();
        unsubRegistry();
      };
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
        validate: runValidate,
        undo: () => getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).undo(),
        redo: () => getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).redo(),
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
      [importProject, exportProject, onError, runValidate],
    );

    // I18nextProvider scopes the builder's PRIVATE i18n instance to this subtree,
    // so the 27 useTranslation() consumers read it (never the host's i18next).
    //
    // The `fh-workflow-builder` root carries the builder's OWN base look (font,
    // text color, antialiasing) on its own element. The builder no longer styles
    // the host's <body> — the host owns the page. `h-full w-full` makes the
    // builder fill whatever container it's mounted in; it never assumes the
    // viewport. TooltipProvider + Toaster live inside the package so the embedder
    // doesn't need to know we use Radix tooltips or shadcn toasts internally.
    return (
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={300}>
          <div className="fh-workflow-builder h-full w-full bg-background text-foreground font-sans antialiased">
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
            {validation && (
              <ValidationDialog
                open
                onOpenChange={(o) => {
                  if (!o) setValidation(null);
                }}
                validation={validation}
                onSelectDiagnostic={navigateToDiagnostic}
              />
            )}
          </div>
        </TooltipProvider>
      </I18nextProvider>
    );
  },
);
