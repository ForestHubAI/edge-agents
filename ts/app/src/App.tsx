import { useCallback, useEffect, useRef, useState } from "react";
import {
  WorkflowBuilder,
  type WorkflowBuilderHandle,
  // The builder re-exports the wire Workflow shape (ApiWorkflow) as `Workflow` —
  // this is the type loadWorkflow/exportWorkflow speak. Import it from the builder,
  // NOT from workflow-core/workflow (that's the in-memory domain type).
  type Workflow,
  // Post host-level notices (save/load failures) to the builder's own toaster, so
  // they share the builder's toast style/surface instead of a second one.
  toast,
} from "@foresthubai/workflow-builder";
import type { ModelInfo } from "@foresthubai/workflow-core/model";
import { CheckCircle2, FileText, FolderOpen, Redo2, Save, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n, { LANG_STORAGE_KEY, type Language } from "./i18n";
import { ThemeToggle } from "./components/ThemeToggle";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { ToolbarButton } from "./components/ToolbarButton";

// Static model catalog — the models the llmproxy supports. The embedder owns
// this list (the builder takes it via props); a real deployment would source it
// from the llmproxy rather than hardcoding. Self-hosted models are declared in
// the builder's Models tab instead.
const MODEL_CATALOG: ModelInfo[] = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", capabilities: ["chat"] },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", capabilities: ["chat"] },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", capabilities: ["chat"] },
];

// Where a workflow lives, so Save can write without re-prompting. Two backends:
// a real disk PATH (only the CLI bridge has one — the dev server writes it), or
// an opaque browser HANDLE (the File System Access API never exposes a path).
// `null` means "no home yet" → Save must establish one first.
type FileTarget = { kind: "path"; path: string } | { kind: "handle"; handle: FileSystemFileHandle };

// `?file=…` query param: if present, the SPA loads/saves through the dev
// server's /api/file bridge (round-trip to disk). Set by `fh-builder open <path>`.
const filePathFromUrl: string | null = new URLSearchParams(window.location.search).get("file");

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

// File System Access API pickers. Available in Chrome/Edge/Opera; absent in
// Firefox/Safari, where we fall back to <input type="file"> + <a download>.
const hasOpenPicker = typeof window !== "undefined" && "showOpenFilePicker" in window;
const hasSavePicker = typeof window !== "undefined" && "showSaveFilePicker" in window;

// Launched via CLI → bound to that disk path from the first frame.
const initialTarget: FileTarget | null = filePathFromUrl ? { kind: "path", path: filePathFromUrl } : null;
const initialName: string | null = filePathFromUrl ? basename(filePathFromUrl) : null;

const FILE_TYPES = [{ description: "Workflow JSON", accept: { "application/json": [".json"] } }];

export default function App() {
  const { t } = useTranslation();
  const builderRef = useRef<WorkflowBuilderHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const initialLoadDone = useRef(false);
  const [dirty, setDirty] = useState(false);
  // Undo/redo availability for the active canvas, pushed by the builder's
  // onHistoryChange (history mutation, undo/redo, AND tab switch).
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Theme + locale persist to localStorage so the toolbar toggles stick across
  // reloads. Dark / "en" are the defaults on first visit.
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("fh-theme") === "light" ? "light" : "dark"),
  );
  // The HOST owns locale: it drives both its own i18n and the builder's
  // `language` prop (the builder follows it and never auto-detects).
  const [lang, setLang] = useState<Language>(() => (localStorage.getItem(LANG_STORAGE_KEY) === "de" ? "de" : "en"));
  // Where Save writes without prompting; null → Save must establish a target.
  const [fileTarget, setFileTarget] = useState<FileTarget | null>(initialTarget);
  // What the title shows; null → "Untitled.json". Distinct from fileTarget: a
  // file opened via <input type="file"> has a name but no writable target.
  const [fileName, setFileName] = useState<string | null>(initialName);

  // Sync the theme to <html> — workflow-builder reads this via its
  // useResolvedTheme hook so the canvas matches the chrome.
  useEffect(() => {
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("fh-theme", theme);
  }, [theme]);

  // Drive the host's i18n from the locale state, and persist the choice.
  useEffect(() => {
    void i18n.changeLanguage(lang);
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  }, [lang]);

  // Mirror the current filename into the browser tab title.
  useEffect(() => {
    const base = fileName ?? "Untitled.json";
    document.title = `${dirty ? "• " : ""}${base} — ForestHub Builder`;
  }, [fileName, dirty]);

  // If launched with ?file=…, load it from the bridge on mount.
  useEffect(() => {
    if (initialLoadDone.current || !filePathFromUrl) return;
    initialLoadDone.current = true;
    fetch(`/api/file?path=${encodeURIComponent(filePathFromUrl)}`)
      .then(async (res) => {
        // 404 → the CLI named a not-yet-existing file; start on an empty canvas.
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        return res.json() as Promise<Workflow>;
      })
      .then((workflow) => {
        if (!workflow) return;
        loadingRef.current = true;
        builderRef.current?.loadWorkflow(workflow);
        queueMicrotask(() => {
          loadingRef.current = false;
          setDirty(false);
        });
      })
      .catch((err) => toast({ title: t("toast.loadFailed"), description: err.message, variant: "destructive" }));
  }, [t]);

  // Parse JSON, hand it to the builder, and record where it came from. `target`
  // is the writable home (or null when we only know a display name).
  const applyLoadedWorkflow = useCallback(
    (text: string, name: string, target: FileTarget | null) => {
      let workflow: Workflow;
      try {
        workflow = JSON.parse(text) as Workflow;
      } catch {
        toast({ title: t("toast.loadFailed"), description: t("error.invalidJson"), variant: "destructive" });
        return;
      }
      loadingRef.current = true;
      builderRef.current?.loadWorkflow(workflow);
      // Microtask: let onChange events from loadWorkflow drain before we drop the
      // loading guard, so the load itself doesn't mark the canvas dirty.
      queueMicrotask(() => {
        loadingRef.current = false;
        setDirty(false);
        setFileName(name);
        setFileTarget(target);
      });
    },
    [t],
  );

  const handleOpen = useCallback(async () => {
    if (dirty && !window.confirm(t("confirm.discard"))) return;
    // Prefer the FSAA open picker — it returns a WRITABLE handle, so Save writes
    // straight back to the same file. <input type="file"> (the cross-browser
    // fallback) gives only a name, so Save there has to prompt for a location.
    if (hasOpenPicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
        if (!handle) return;
        const file = await handle.getFile();
        applyLoadedWorkflow(await file.text(), handle.name, { kind: "handle", handle });
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled
        toast({ title: t("toast.loadFailed"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      }
      return;
    }
    fileInputRef.current?.click();
  }, [dirty, t, applyLoadedWorkflow]);

  // <input type="file"> fallback (no FSAA). The confirm-on-dirty already ran in
  // handleOpen before the input was triggered. Name only → null target.
  const handleFileChosen = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      file
        .text()
        .then((text) => applyLoadedWorkflow(text, file.name, null))
        .catch((err) => toast({ title: t("toast.loadFailed"), description: err.message, variant: "destructive" }));
      e.target.value = ""; // allow re-selecting the same file
    },
    [applyLoadedWorkflow, t],
  );

  const handleSave = useCallback(async () => {
    const workflow = builderRef.current?.exportWorkflow();
    if (!workflow) return;
    const body = JSON.stringify(workflow, null, 2);

    // CLI bridge target → PUT to disk at the bound path.
    if (fileTarget?.kind === "path") {
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(fileTarget.path)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        setDirty(false); // dot clears → that's the success confirmation
      } catch (err) {
        toast({ title: t("toast.saveFailed"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      }
      return;
    }

    // Browser FSAA handle → write straight back, no prompt.
    if (fileTarget?.kind === "handle") {
      try {
        const writable = await fileTarget.handle.createWritable();
        await writable.write(body);
        await writable.close();
        setDirty(false);
      } catch (err) {
        toast({ title: t("toast.saveFailed"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      }
      return;
    }

    // No target yet. Establish one: FSAA save picker (record the handle so the
    // next Save is silent), else fall back to a plain download.
    if (hasSavePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: fileName ?? "workflow.json", types: FILE_TYPES });
        const writable = await handle.createWritable();
        await writable.write(body);
        await writable.close();
        setFileTarget({ kind: "handle", handle });
        setFileName(handle.name);
        setDirty(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return; // user cancelled
        toast({ title: t("toast.saveFailed"), description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      }
      return;
    }

    // Fallback: <a download>. Browser decides where (downloads folder).
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName ?? `workflow-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDirty(false);
  }, [fileTarget, fileName, t]);

  const handleNew = useCallback(() => {
    if (dirty && !window.confirm(t("confirm.discard"))) return;
    loadingRef.current = true;
    builderRef.current?.clear();
    queueMicrotask(() => {
      loadingRef.current = false;
      setDirty(false);
      // New starts an untitled document. A CLI-bound path is kept — Save writes
      // the empty canvas back to that file (resetting it). A browser handle or
      // no target is dropped, so the next Save prompts for a fresh location.
      if (fileTarget?.kind !== "path") {
        setFileTarget(null);
        setFileName(null);
      }
    });
  }, [dirty, fileTarget, t]);

  // The builder owns the validate UX (success toast / issues dialog), so this is
  // just a trigger.
  const handleValidate = useCallback(() => {
    builderRef.current?.validate();
  }, []);

  const handleChange = useCallback(() => {
    if (loadingRef.current) return;
    setDirty(true);
  }, []);

  // Undo/redo availability for the active canvas — pushed by the builder on
  // history mutation, undo/redo, AND tab switch (separate from onChange, so a tab
  // switch updates the buttons without marking the document dirty).
  const handleHistoryChange = useCallback((state: { canUndo: boolean; canRedo: boolean }) => {
    setCanUndo(state.canUndo);
    setCanRedo(state.canRedo);
  }, []);

  const handleError = useCallback(
    (err: Error) => {
      toast({ title: t("toast.error"), description: err.message, variant: "destructive" });
    },
    [t],
  );

  // Ctrl/Cmd+S saves through the same path as the toolbar button (writes to the
  // open file when there is one). Without intercepting it, the browser's native
  // "save page as" dialog hijacks the shortcut and prompts for a location.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        {/* Left zone: workflow + canvas actions, pinned to the left edge. */}
        <ToolbarButton icon={FileText} onClick={handleNew}>
          {t("toolbar.new")}
        </ToolbarButton>
        <ToolbarButton icon={FolderOpen} onClick={handleOpen}>
          {t("toolbar.open")}
        </ToolbarButton>
        <ToolbarButton icon={Save} variant="primary" onClick={handleSave}>
          {t("toolbar.save")}
        </ToolbarButton>
        <ToolbarButton icon={CheckCircle2} onClick={handleValidate}>
          {t("toolbar.validate")}
        </ToolbarButton>
        {/* Workflow-scoped ops above | canvas-scoped undo/redo below. */}
        <div className="mx-1 h-5 w-px bg-border" aria-hidden />
        <ToolbarButton icon={Undo2} onClick={() => builderRef.current?.undo()} disabled={!canUndo}>
          {t("toolbar.undo")}
        </ToolbarButton>
        <ToolbarButton icon={Redo2} onClick={() => builderRef.current?.redo()} disabled={!canRedo}>
          {t("toolbar.redo")}
        </ToolbarButton>

        {/* Center zone: document identity. flex-1 absorbs all width variability so
            neither side group moves; the name truncates and the dirty dot has a
            reserved, never-clipped slot, so toggling dirty causes no reflow. */}
        <div
          className="flex-1 min-w-0 flex items-center justify-center gap-1.5 text-sm font-mono text-muted-foreground"
          title={fileTarget?.kind === "path" ? fileTarget.path : (fileName ?? "no file")}
        >
          <span className="truncate">{fileName ?? "Untitled.json"}</span>
          <span className="shrink-0 w-2 text-center text-foreground" aria-hidden>
            {dirty ? "•" : ""}
          </span>
        </div>

        {/* Right zone: app chrome, pinned to the right edge. */}
        <ThemeToggle theme={theme} onToggle={() => setTheme((th) => (th === "dark" ? "light" : "dark"))} />
        <LanguageSwitcher language={lang} onChange={setLang} />
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label={t("toolbar.open")}
          onChange={handleFileChosen}
        />
      </header>

      <main className="flex-1 min-h-0">
        <WorkflowBuilder
          ref={builderRef}
          models={MODEL_CATALOG}
          language={lang}
          onChange={handleChange}
          onHistoryChange={handleHistoryChange}
          onError={handleError}
        />
      </main>
    </div>
  );
}
