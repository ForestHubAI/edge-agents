import { useCallback, useEffect, useRef, useState } from "react";
import {
  WorkflowBuilder,
  type WorkflowBuilderHandle,
  type Schemas,
} from "@foresthub/visual-builder";

export default function App() {
  const builderRef = useRef<WorkflowBuilderHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>("Ready");
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  // Sync the theme to <html> — visual-builder reads this via its
  // useResolvedTheme hook so the canvas matches the chrome.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
  }, [theme]);

  const handleOpenClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChosen = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        const workflow = JSON.parse(text) as Schemas["Workflow"];
        loadingRef.current = true;
        builderRef.current?.loadWorkflow(workflow);
        // Microtask: allow onChange events from loadWorkflow to drain before
        // we drop the loading guard.
        queueMicrotask(() => {
          loadingRef.current = false;
          setDirty(false);
          setStatus(`Loaded ${file.name}`);
        });
      })
      .catch((err) => setStatus(`Load failed: ${err.message}`));
    // Allow re-selecting the same file
    e.target.value = "";
  }, []);

  const handleSave = useCallback(() => {
    const workflow = builderRef.current?.exportWorkflow();
    if (!workflow) return;
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDirty(false);
    setStatus("Saved");
  }, []);

  const handleClear = useCallback(() => {
    loadingRef.current = true;
    builderRef.current?.clear();
    queueMicrotask(() => {
      loadingRef.current = false;
      setDirty(false);
      setStatus("Cleared");
    });
  }, []);

  const handleValidate = useCallback(() => {
    const result = builderRef.current?.validate();
    if (!result) return;
    if (result.totalErrors === 0 && result.totalWarnings === 0) {
      setStatus("Valid ✓");
    } else {
      setStatus(`${result.totalErrors} errors, ${result.totalWarnings} warnings`);
    }
  }, []);

  const handleChange = useCallback(() => {
    if (loadingRef.current) return;
    setDirty(true);
  }, []);

  const handleError = useCallback((err: Error) => {
    setStatus(`Error: ${err.message}`);
  }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        <strong className="text-sm mr-3">ForestHub Agent Builder</strong>
        <button
          onClick={handleOpenClick}
          className="px-3 py-1 text-sm rounded border border-border bg-secondary text-secondary-foreground hover:bg-muted"
        >
          Open…
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1 text-sm rounded border border-border bg-primary text-primary-foreground hover:opacity-90"
        >
          Save {dirty ? "•" : ""}
        </button>
        <button
          onClick={handleClear}
          className="px-3 py-1 text-sm rounded border border-border bg-secondary text-secondary-foreground hover:bg-muted"
        >
          Clear
        </button>
        <button
          onClick={handleValidate}
          className="px-3 py-1 text-sm rounded border border-border bg-secondary text-secondary-foreground hover:bg-muted"
        >
          Validate
        </button>
        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="px-3 py-1 text-sm rounded border border-border bg-secondary text-secondary-foreground hover:bg-muted"
          title="Toggle theme"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
        <span className="ml-auto text-xs text-muted-foreground">{status}</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={handleFileChosen}
        />
      </header>

      <main className="flex-1 min-h-0">
        <WorkflowBuilder
          ref={builderRef}
          onChange={handleChange}
          onError={handleError}
        />
      </main>
    </div>
  );
}
