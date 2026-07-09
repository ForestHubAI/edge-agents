// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

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
import { useFunctionDiagnosticsSync } from "./hooks/useFunctionDiagnosticsSync";
import { useSuppressThemeTransition } from "./hooks/useSuppressThemeTransition";
import { useFunctions } from "./hooks/useFunctions";
import { useWorkflowSerialization, readStateFromStores } from "./hooks/useWorkflowSerialization";
import {
  getAllCanvasStores,
  getOrCreateCanvasStore,
  subscribeCanvasRegistryChanges,
  MAIN_CANVAS_ID,
  type CanvasStore,
} from "./stores/canvasStore";
import { useDebugStore, type DebugSessionPhase } from "./stores/debugStore";
import { useEditorStore } from "./stores/editorStore";

import type { BuilderMode } from "./mode";

// ============================================================================
// Public contract
// ============================================================================

export interface WorkflowBuilderProps {
  /** Workflow loaded on mount. If none is provided, an empty workflow is created. */
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
  /**
   * Fires after any USER domain-state mutation. Pull current state via
   * handle.exportWorkflow(). Programmatic loads (handle.loadWorkflow /
   * handle.clear) do NOT fire this — hosts can reset their dirty flag right
   * after those calls without guarding against echoes.
   */
  onChange?: () => void;
  /**
   * Undo/redo availability for the ACTIVE canvas changed — on history mutation,
   * undo/redo, or a tab switch (each canvas has its own history). For wiring host
   * undo/redo buttons.
   */
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
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

  // Initiate the in-builder validation process which will either show the validation dialog or a toast if clean.
  validate: () => void;

  // History (so embedder chrome can wire undo/redo buttons)
  undo: () => void;
  redo: () => void;

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
      onError,
    } = props;

    // Host drives locale. useLayoutEffect (not useEffect) so the language is set
    // before paint — mounting with language="de" shows German on the first frame
    // rather than flashing English. changeLanguage is sync here (bundled resources).
    useLayoutEffect(() => {
      if (language && i18n.language !== language) i18n.changeLanguage(language);
    }, [language]);

    const { importProject, exportProject, clearProject } = useWorkflowSerialization();

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
    // Functions are a FunctionDeclaration (not a flat resource bag), so they use a
    // dedicated diagnostics sync.
    useFunctionDiagnosticsSync();

    // Push the embedder-supplied model catalog into the store so agent model
    // pickers can read it. Catalog is config (not workflow content), so this
    // never fires onChange.
    useEffect(() => {
      useEditorStore.getState().setAvailableModels(models ?? []);
    }, [models]);

    // Canvas tabs + functions live here because they survive canvas switches.
    const canvasTabs = useCanvasTabs();
    const functionsHook = useFunctions({ onOpenTab: canvasTabs.openTab });

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
          editor.selectChannel(d.channelId);
        } else if (d.memoryId) {
          editor.setActiveSidebarTab("memory");
          editor.selectMemory(d.memoryId);
        } else if (d.modelId) {
          editor.setActiveSidebarTab("models");
          editor.selectModel(d.modelId);
        } else if (d.canvasId) {
          // Switch first so selectGraph targets the right canvas, then select.
          if (d.canvasId === MAIN_CANVAS_ID) editor.setActiveCanvas(MAIN_CANVAS_ID);
          else functionsHook.openFunction(d.canvasId);
          if (d.nodeId) editor.selectGraph([d.nodeId], []);
          else if (d.edgeId) editor.selectGraph([], [d.edgeId]);
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
        // No initialWorkflow → start empty; the module-level stores may still hold the
        // previously mounted project, so clear them rather than leaving them untouched.
        if (initialWorkflow) importProject(initialWorkflow);
        else clearProject();
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Lifecycle subscriptions ────────────────────────────────────────────
    // Stash latest callbacks in refs so the subscription effect runs once.
    const onChangeRef = useRef(onChange);
    const onHistoryChangeRef = useRef(onHistoryChange);
    onChangeRef.current = onChange;
    onHistoryChangeRef.current = onHistoryChange;

    // onChange means "the USER changed the document". Programmatic loads
    // (handle.loadWorkflow / handle.clear) mutate the same stores, so their
    // subscription callbacks — which zustand runs synchronously inside the
    // store writes — are muted while this flag is up. Without it every host
    // sees phantom onChange events on load and has to guard its dirty flag.
    const suppressChangeRef = useRef(false);

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
            prev = state.mutationCount; // always track, even when muted
            if (!suppressChangeRef.current) onChangeRef.current?.();
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

      // Canvas stores come and go (function add/delete, project load). Re-subscribe
      // to the new set so newly created function bodies are watched. We do NOT fire
      // onChange here: function add/delete/rename and all definition edits flow
      // through editorStore.mutationCount (setFunctions), caught by the editor
      // subscription below — so the change signal is covered without double-firing.
      const unsubRegistry = subscribeCanvasRegistryChanges(() => {
        subscribeAllCanvases();
      });
      subs.push(unsubRegistry);

      // Project-scoped mutations (channels, memory, models, functions).
      let prevEditorCount = useEditorStore.getState().mutationCount;
      const unsubEditor = useEditorStore.subscribe((state) => {
        if (state.mutationCount !== prevEditorCount) {
          prevEditorCount = state.mutationCount; // always track, even when muted
          if (!suppressChangeRef.current) onChangeRef.current?.();
        }
      });
      subs.push(unsubEditor);

      return () => {
        for (const u of subs) u();
      };
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
      const unsubRegistry = subscribeCanvasRegistryChanges(bindActive); // (c) load/clear rebuild

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
          suppressChangeRef.current = true;
          try {
            importProject(workflow);
          } catch (e) {
            onError?.(e instanceof Error ? e : new Error(String(e)));
          } finally {
            suppressChangeRef.current = false;
          }
        },
        exportWorkflow: () => exportProject(),
        clear: () => {
          suppressChangeRef.current = true;
          try {
            clearProject();
          } finally {
            suppressChangeRef.current = false;
          }
        },
        setMode: (mode) => useEditorStore.getState().setBuilderMode(mode),
        getMode: () => useEditorStore.getState().builderMode,
        validate: runValidate,
        undo: () => getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).undo(),
        redo: () => getOrCreateCanvasStore(useEditorStore.getState().activeCanvasId).redo(),
        setDebugPhase: (phase) => useDebugStore.getState().setPhase(phase),
      }),
      [importProject, exportProject, clearProject, onError, runValidate],
    );

    // I18nextProvider scopes the builder's PRIVATE i18n instance to this subtree,
    // so the useTranslation() consumers read it (never the host's i18next).
    //
    // The `fh-builder` root carries the builder's OWN base look (font,
    // text color, antialiasing) on its own element. The builder no longer styles
    // the host's <body> — the host owns the page. `h-full w-full` makes the
    // builder fill whatever container it's mounted in; it never assumes the
    // viewport. TooltipProvider + Toaster live inside the package so the embedder
    // doesn't need to know we use Radix tooltips or shadcn toasts internally.
    return (
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={300}>
          <div className="fh-builder h-full w-full bg-background text-foreground font-sans antialiased">
            <BuilderLayout
              functions={functionsHook.functions}
              onOpenFunction={functionsHook.openFunction}
              onCreateFunction={functionsHook.createFunction}
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
