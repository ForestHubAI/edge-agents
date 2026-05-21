import { useState, useCallback } from "react";
import { MAIN_CANVAS_ID } from "../stores/canvasStore";
import { useEditorStore } from "../stores/editorStore";

// Holds info for a canvas tab. id is identical to canvasId.
export interface CanvasTab {
  id: string;
  label: string;
}

/**
 * Hook for managing canvas tabs UI.
 * Tab switching directly updates the UI store's activeCanvasId.
 */
export const useCanvasTabs = () => {
  const [tabs, setTabs] = useState<CanvasTab[]>([{ id: MAIN_CANVAS_ID, label: "Main" }]);

  // Get active canvas ID and setter from editor store
  const activeCanvasId = useEditorStore((state) => state.activeCanvasId);
  const setActiveCanvas = useEditorStore((state) => state.setActiveCanvas);

  // Set active tab switches to the corresponding canvas
  const setActiveTabId = useCallback(
    (tabId: string) => {
      setActiveCanvas(tabId);
    },
    [setActiveCanvas],
  );

  // Open a tab for a function (add if not exists, switch to it)
  const openTab = useCallback(
    (id: string, label: string) => {
      setTabs((prev) => {
        const existing = prev.find((t) => t.id === id);
        if (existing) {
          return prev; // Already exists
        }
        return [...prev, { id, label }];
      });
      setActiveCanvas(id);
      return id;
    },
    [setActiveCanvas],
  );

  // Close a tab (just removes from visible tabs, does NOT delete canvas data)
  const closeTab = useCallback(
    (tabId: string) => {
      // Cannot close main tab
      if (tabId === MAIN_CANVAS_ID) return;

      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tabId);
        // If closing active tab, switch to main
        if (tabId === activeCanvasId) {
          setActiveCanvas(MAIN_CANVAS_ID);
        }
        return filtered;
      });
    },
    [activeCanvasId, setActiveCanvas],
  );

  // Remove a tab completely (called when function is deleted)
  const removeTab = useCallback(
    (tabId: string) => {
      if (tabId === MAIN_CANVAS_ID) return;

      setTabs((prev) => {
        const filtered = prev.filter((t) => t.id !== tabId);
        // Switch to main canvas if removing active tab
        if (tabId === activeCanvasId) {
          setActiveCanvas(MAIN_CANVAS_ID);
        }
        return filtered;
      });
    },
    [activeCanvasId, setActiveCanvas],
  );

  const renameTab = useCallback((tabId: string, newLabel: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, label: newLabel } : t)));
  }, []);

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === 0 || toIndex === 0) return;
    setTabs((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(fromIndex, 1);
      if (!moved) return prev;
      updated.splice(toIndex, 0, moved);
      return updated;
    });
  }, []);

  // Reset to main canvas only (closes all function tabs)
  const resetToMain = useCallback(() => {
    setTabs([{ id: MAIN_CANVAS_ID, label: "Main" }]);
    setActiveCanvas(MAIN_CANVAS_ID);
  }, [setActiveCanvas]);

  // Restore a previously saved tab state
  const restoreTabState = useCallback(
    (savedTabs: CanvasTab[], savedActiveId: string) => {
      setTabs(savedTabs);
      setActiveCanvas(savedActiveId);
    },
    [setActiveCanvas],
  );

  // Get label for a tab
  const getTabLabel = useCallback(
    (tabId: string) => {
      return tabs.find((t) => t.id === tabId)?.label || "Unknown";
    },
    [tabs],
  );

  return {
    tabs,
    activeTabId: activeCanvasId,
    setActiveTabId,
    openTab,
    closeTab,
    removeTab,
    renameTab,
    reorderTabs,
    resetToMain,
    restoreTabState,
    getTabLabel,
    isMainCanvas: activeCanvasId === MAIN_CANVAS_ID,
  };
};
