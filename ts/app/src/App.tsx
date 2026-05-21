import { useCallback, useEffect, useRef, useState } from "react";
import {
  WorkflowBuilder,
  type WorkflowBuilderHandle,
} from "@foresthub/workflow-builder";
import type { Workflow } from "@foresthub/workflow-core/workflow";

// `?file=…` query param: if present, the SPA loads/saves through the dev
// server's /api/file bridge (round-trip to disk) instead of using <input
// type="file"> + <a download>. Set by the CLI via fh-builder open <path>.
const filePathFromUrl: string | null =
  new URLSearchParams(window.location.search).get("file");

// Standalone-mode "save back to disk" needs the File System Access API
// (showSaveFilePicker). Available in Chrome/Edge/Opera; absent in Firefox
// and Safari, where we fall back to a timestamped download.
const hasFsAccess = typeof window !== "undefined" && "showSaveFilePicker" in window;

export default function App() {
  const builderRef = useRef<WorkflowBuilderHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const initialLoadDone = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<string>(
    filePathFromUrl ? `Loading ${filePathFromUrl}…` : "Ready",
  );
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  // If launched via CLI with ?file=…, this is the path we read/write through.
  const [boundPath] = useState<string | null>(filePathFromUrl);
  // Standalone-mode write-back handle (set by Save's first prompt; reused
  // on subsequent saves so they skip the picker).
  const [fileHandle, setFileHandle] = useState<FileSystemFileHandle | null>(null);
  // Displayed in the toolbar. Sourced from boundPath, fileHandle.name, or
  // the last `<input type="file">` selection.
  const [currentName, setCurrentName] = useState<string | null>(
    filePathFromUrl ? filePathFromUrl.split(/[\\/]/).pop() ?? null : null,
  );

  // Sync the theme to <html> — workflow-builder reads this via its
  // useResolvedTheme hook so the canvas matches the chrome.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("light", theme === "light");
  }, [theme]);

  // Mirror the current filename into the browser tab title.
  useEffect(() => {
    const base = currentName ?? "Untitled";
    document.title = `${dirty ? "• " : ""}${base} — ForestHub Builder`;
  }, [currentName, dirty]);

  // If we were launched with ?file=…, load it from the bridge on mount.
  useEffect(() => {
    if (initialLoadDone.current || !boundPath) return;
    initialLoadDone.current = true;
    fetch(`/api/file?path=${encodeURIComponent(boundPath)}`)
      .then(async (res) => {
        if (res.status === 404) {
          setStatus(`New file: ${boundPath} (empty canvas)`);
          return null;
        }
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
          setStatus(`Loaded ${boundPath}`);
        });
      })
      .catch((err) => setStatus(`Load failed: ${err.message}`));
  }, [boundPath]);

  const handleOpenClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChosen = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        const workflow = JSON.parse(text) as Workflow;
        loadingRef.current = true;
        builderRef.current?.loadWorkflow(workflow);
        // Microtask: allow onChange events from loadWorkflow to drain before
        // we drop the loading guard.
        queueMicrotask(() => {
          loadingRef.current = false;
          setDirty(false);
          // <input type="file"> gives us a name to display, but not a
          // write-capable handle. Save will need a fresh showSaveFilePicker
          // prompt (or download fallback).
          setCurrentName(file.name);
          setFileHandle(null);
          setStatus(`Loaded ${file.name}`);
        });
      })
      .catch((err) => setStatus(`Load failed: ${err.message}`));
    // Allow re-selecting the same file
    e.target.value = "";
  }, []);

  const handleSave = useCallback(async () => {
    const workflow = builderRef.current?.exportWorkflow();
    if (!workflow) return;
    const body = JSON.stringify(workflow, null, 2);

    // Bridge mode: PUT to disk at the bound path. Used when launched via
    // `fh-builder open <file>` (sets ?file=… in the URL).
    if (boundPath) {
      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(boundPath)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
        setDirty(false);
        setStatus(`Saved to ${boundPath}`);
      } catch (err) {
        setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // Standalone mode. Three sub-paths:
    //   1. Have a stored FSAA handle (from previous Save) → write directly.
    //   2. FSAA available → prompt with showSaveFilePicker, store handle.
    //   3. FSAA unavailable → download with the current name as hint.

    if (fileHandle) {
      try {
        const writable = await fileHandle.createWritable();
        await writable.write(body);
        await writable.close();
        setDirty(false);
        setStatus(`Saved to ${fileHandle.name}`);
      } catch (err) {
        setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (hasFsAccess) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: currentName ?? "workflow.json",
          types: [
            {
              description: "Workflow JSON",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(body);
        await writable.close();
        setFileHandle(handle);
        setCurrentName(handle.name);
        setDirty(false);
        setStatus(`Saved to ${handle.name}`);
      } catch (err) {
        // User cancelled the picker — quietly ignore. Any other error gets surfaced.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    // Fallback: <a download>. Browser decides where (downloads folder).
    const blob = new Blob([body], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = currentName ?? `workflow-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDirty(false);
    setStatus("Downloaded");
  }, [boundPath, fileHandle, currentName]);

  const handleClear = useCallback(() => {
    loadingRef.current = true;
    builderRef.current?.clear();
    queueMicrotask(() => {
      loadingRef.current = false;
      setDirty(false);
      // Clear severs the link to whatever was open — title goes back to
      // "Untitled" and the next Save prompts for a fresh location.
      // (Bridge-mode boundPath stays — that path was chosen by the CLI.)
      if (!boundPath) {
        setCurrentName(null);
        setFileHandle(null);
      }
      setStatus("Cleared");
    });
  }, [boundPath]);

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
        <strong
          className="text-sm mr-3 font-mono"
          title={boundPath ?? currentName ?? "no file"}
        >
          {currentName ?? "Untitled"}
          {dirty ? " •" : ""}
        </strong>
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
          Save
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
