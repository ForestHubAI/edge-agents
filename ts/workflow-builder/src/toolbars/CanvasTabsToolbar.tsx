import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { cn } from "../lib/utils";
import { FunctionSquare, Plus, Workflow, X } from "lucide-react";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { FunctionInfo } from "@foresthub/workflow-core/node";
import { CanvasTab } from "../hooks/useCanvasTabs";
import { MAIN_CANVAS_ID } from "../store/canvasStore";

interface CanvasTabsToolbarProps {
  tabs: CanvasTab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabReorder: (fromIndex: number, toIndex: number) => void;
  functions: FunctionInfo[];
  onOpenFunction: (id: string) => void;
  onAddNewFunction: () => void;
}

export const CanvasTabsToolbar = ({
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
  onTabReorder,
  functions,
  onOpenFunction,
  onAddNewFunction,
}: CanvasTabsToolbarProps) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const dragIndex = useRef<number | null>(null);

  const openTabIds = useMemo(() => new Set(tabs.map((t) => t.id)), [tabs]);
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
      // Indicator position: center of the gap (gap-1 = 4px) between tabs
      const GAP_HALF = 2;
      const raw = isLeftHalf
        ? rect.left - containerRect.left - GAP_HALF
        : rect.right - containerRect.left + GAP_HALF;
      // Clamp so the indicator stays fully visible inside the container
      const x = Math.round(Math.max(0, Math.min(raw, containerRef.current.clientWidth - 2)));

      setDropSlot(slot);
      setIndicatorX(x);
    },
    [tabs],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1 px-2 py-2.5 bg-card/80 border-b border-border/50 min-h-[44px] overflow-x-auto"
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
          className="absolute top-1.5 bottom-1.5 bg-primary z-10 pointer-events-none"
          style={{ left: 0, width: '2px', transform: `translateX(${indicatorX}px)` }}
        />
      )}

      {tabs.map((tab, index) => {
        const isDraggable = !isMainTab(index);

        return (
          <React.Fragment key={tab.id}>
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
                "group flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-all",
                "hover:bg-field/80",
                activeTabId === tab.id
                  ? "bg-field text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground",
                isDraggable ? "cursor-grab active:cursor-grabbing" : "select-none",
              )}
              onClick={() => onTabChange(tab.id)}
            >
              <Workflow className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[120px]">{tab.label}</span>
              {tab.id !== MAIN_CANVAS_ID && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "w-4 h-4 p-0 opacity-0 group-hover:opacity-100 transition-opacity",
                    "hover:bg-destructive/10 hover:text-destructive",
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTabClose(tab.id);
                  }}
                >
                  <X className="w-3 h-3" />
                </Button>
              )}
            </div>

            {/* Static separator after Main tab */}
            {isMainTab(index) && tabs.length > 1 && (
              <div className="w-px h-5 bg-border/70 mx-0.5 shrink-0" />
            )}
          </React.Fragment>
        );
      })}

      {/* Function dropdown button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 shrink-0 text-muted-foreground hover:text-foreground"
            title={t("functions")}
          >
            <Plus className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {functions.map((fn) => (
            <DropdownMenuItem
              key={fn.id}
              onClick={() => onOpenFunction(fn.id)}
              className="gap-2"
            >
              <FunctionSquare className="w-4 h-4 shrink-0" />
              <span className="truncate">{fn.name}</span>
              {openTabIds.has(fn.id) && (
                <span className="ml-auto text-xs text-muted-foreground">open</span>
              )}
            </DropdownMenuItem>
          ))}
          {functions.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={onAddNewFunction} className="gap-2">
            <Plus className="w-4 h-4 shrink-0" />
            {t("newFunction")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
