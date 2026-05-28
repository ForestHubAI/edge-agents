import { ScrollArea } from "../components/ui/scroll-area";
import { cn } from "../lib/utils";
import { FunctionSquare, Workflow, X } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { CanvasTab } from "../hooks/useCanvasTabs";
import { MAIN_CANVAS_ID } from "../stores/canvasStore";

interface CanvasTabsToolbarProps {
  tabs: CanvasTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
}

export const CanvasTabsToolbar = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onTabReorder,
}: CanvasTabsToolbarProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragIndex = useRef<number | null>(null);

  // Translate vertical mouse-wheel deltas into horizontal scroll on the tabs
  // viewport. A non-passive native listener is required because React's
  // synthetic onWheel is passive — preventDefault() there is a no-op, so the
  // page would also scroll vertically alongside the toolbar shift. We leave
  // genuine horizontal wheels (touchpads, tilt wheels) alone by gating on
  // deltaY, and skip the override entirely when there's nothing to scroll
  // so vertical-page scrolling still works when the pointer happens to
  // hover an unfilled toolbar.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // dropSlot: insertion index (before which tab the dragged tab lands)
  const [dropSlot, setDropSlot] = useState<number | null>(null);
  // indicatorX: pixel offset from container left for the visual line
  const [indicatorX, setIndicatorX] = useState<number | null>(null);

  const isMainTab = (index: number) => tabs[index]?.id === MAIN_CANVAS_ID;

  const clearDrag = useCallback(() => {
    dragIndex.current = null;
    setDropSlot(null);
    setIndicatorX(null);
  }, []);

  const handleTabDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      if (dragIndex.current === null || !containerRef.current) return;
      // Ignore Main tab entirely — not a valid drag target
      if (tabs[index]?.id === MAIN_CANVAS_ID) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";

      const rect = e.currentTarget.getBoundingClientRect();
      const containerRect = containerRef.current.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const isLeftHalf = e.clientX < midX;

      // Slot: insertion index
      const slot = isLeftHalf ? index : index + 1;
      // Tabs are now flush with a 1px separator between them — land the indicator on that seam.
      const raw = isLeftHalf ? rect.left - containerRect.left : rect.right - containerRect.left;
      // Clamp so the indicator stays fully visible inside the container
      const x = Math.round(Math.max(0, Math.min(raw, containerRef.current.clientWidth - 2)));

      setDropSlot(slot);
      setIndicatorX(x);
    },
    [tabs],
  );

  return (
    // ScrollArea provides the horizontal overlay scrollbar (hover-only, in the
    // panel gutter so the tab row doesn't shift). The Root carries the bg +
    // bottom border; the inner div inside the Viewport stays the drag/drop
    // container — containerRef points at it so the indicator's coordinates
    // remain relative to the (scrollable) tab row, not the fixed Root.
    <ScrollArea className="bg-card/80 border-b border-border/50" viewportRef={viewportRef}>
      <div
        ref={containerRef}
        className="relative flex items-stretch"
        onDragOver={(e) => {
          // Fallback for empty area past last tab
          if (dragIndex.current === null || !containerRef.current) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragIndex.current !== null && dropSlot !== null) {
            const from = dragIndex.current;
            const target = dropSlot > from ? dropSlot - 1 : dropSlot;
            if (target > 0 && target !== from) {
              onTabReorder(from, target);
            }
          }
          clearDrag();
        }}
      >
      {/* Absolute drop indicator — no layout shift */}
      {indicatorX !== null && (
        <div
          className="absolute top-0 bottom-0 bg-primary z-10 pointer-events-none"
          style={{ left: 0, width: "2px", transform: `translateX(${indicatorX}px)` }}
        />
      )}

      {tabs.map((tab, index) => {
        const isDraggable = !isMainTab(index);

        return (
          <React.Fragment key={tab.id}>
            {index > 0 && <div className="w-px bg-border/70 shrink-0" />}
            <div
              draggable={isDraggable}
              onDragStart={(e) => {
                if (!isDraggable) return;
                dragIndex.current = index;
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => handleTabDragOver(e, index)}
              onDragEnd={clearDrag}
              className={cn(
                "group flex items-center gap-1.5 pl-2 pr-1 text-sm font-medium cursor-pointer transition-colors",
                "hover:bg-field/80",
                activeTabId === tab.id
                  ? "bg-field text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                isDraggable ? "cursor-grab active:cursor-grabbing" : "select-none",
              )}
              onClick={() => onTabChange(tab.id)}
            >
              {isMainTab(index) ? (
                <Workflow className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <FunctionSquare className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="truncate max-w-[120px] py-1">{tab.label}</span>
              {tab.id !== MAIN_CANVAS_ID ? (
                <button
                  type="button"
                  className="flex items-center justify-center w-4 h-4 shrink-0 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/15 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : (
                <span className="w-1 shrink-0" />
              )}
            </div>
          </React.Fragment>
        );
      })}

      </div>
    </ScrollArea>
  );
};
