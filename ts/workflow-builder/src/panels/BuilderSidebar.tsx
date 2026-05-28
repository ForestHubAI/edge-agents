import { Button } from "../components/ui/button";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import { NodeCategory, NodeDefinition } from "@foresthubai/workflow-core/node";
import { useMemo } from "react";
import { Blocks, BrainCircuit, Braces, Bug, Cpu, Database, TriangleAlert, Variable, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { FunctionListPanel } from "./FunctionListPanel";
import NodeLibrary from "./NodeLibrary";
import { ChannelsPanel } from "./ChannelsPanel";
import { MemoryPanel } from "./MemoryPanel";
import { ModelsPanel } from "./ModelsPanel";
import { VariablesPanel } from "./VariablesPanel";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { DebugContextPanel } from "./DebugContextPanel";
import type { FunctionDeclaration } from "@foresthubai/workflow-core/function";

export type SidebarTab =
  | "nodes"
  | "variables"
  | "channels"
  | "memory"
  | "models"
  | "functions"
  | "diagnostics"
  | "debug-context"
  | null;

interface BuilderSidebarProps {
  canvasId: string;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onAddNode: (nodeType: NodeDefinition, position?: { x: number; y: number }) => void;
  nodeDefinitions: NodeDefinition[];
  getAllCategories: () => NodeCategory[];
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  isFunctionCanvas: boolean;
  // Function management
  functions: FunctionDeclaration[];
  onOpenFunction: (functionId: string) => void;
  onCreateFunction: () => string;
  // Debug mode
  isDebugMode?: boolean;
}

export const BuilderSidebar = ({
  canvasId,
  activeTab,
  onTabChange,
  onAddNode,
  nodeDefinitions,
  getAllCategories,
  onSelectNode,
  onSelectEdge,
  isFunctionCanvas,
  functions,
  onOpenFunction,
  onCreateFunction,
  isDebugMode,
}: BuilderSidebarProps) => {
  const { t } = useTranslation();

  const staticTabs = useMemo(
    () => [
      { id: "nodes" as const, icon: Blocks, label: t("nodeLibrary") },
      { id: "variables" as const, icon: Variable, label: t("variables") },
      { id: "channels" as const, icon: Cpu, label: t("channels") },
      { id: "memory" as const, icon: Database, label: t("memoryFiles", "Memory") },
      { id: "models" as const, icon: BrainCircuit, label: t("models", "AI Models") },
      { id: "functions" as const, icon: Braces, label: t("functions") },
      { id: "diagnostics" as const, icon: TriangleAlert, label: t("diagnostics") },
    ],
    [t],
  );

  const debugTabs = useMemo(() => [{ id: "debug-context" as const, icon: Bug, label: t("debug.context") }], [t]);

  // Current-canvas diagnostics counts for the diagnostics tab — node + edge only.
  const totalErrors = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byNodeId)) for (const d of diags) if (d.severity === "error") count++;
    for (const diags of Object.values(s.byEdgeId)) for (const d of diags) if (d.severity === "error") count++;
    return count;
  });
  const totalWarnings = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byNodeId)) for (const d of diags) if (d.severity === "warning") count++;
    for (const diags of Object.values(s.byEdgeId)) for (const d of diags) if (d.severity === "warning") count++;
    return count;
  });

  // Channels are project-scoped and own their own tab/badge — counts here
  // drive the "channels" tab icon color + badge (mirrors the diagnostics tab).
  const channelErrors = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byChannelId)) for (const d of diags) if (d.severity === "error") count++;
    return count;
  });
  const channelWarnings = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byChannelId)) for (const d of diags) if (d.severity === "warning") count++;
    return count;
  });

  // Memory primitives are project-scoped too — counts drive the "memory" tab
  // icon color + badge (mirrors the channels tab).
  const memoryErrors = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byMemoryId)) for (const d of diags) if (d.severity === "error") count++;
    return count;
  });
  const memoryWarnings = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byMemoryId)) for (const d of diags) if (d.severity === "warning") count++;
    return count;
  });

  // Declared models are project-scoped too — counts drive the "models" tab badge.
  const modelErrors = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byModelId)) for (const d of diags) if (d.severity === "error") count++;
    return count;
  });
  const modelWarnings = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byModelId)) for (const d of diags) if (d.severity === "warning") count++;
    return count;
  });

  // Functions are project-scoped too — counts drive the "functions" tab badge.
  const functionErrors = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byFunctionId)) for (const d of diags) if (d.severity === "error") count++;
    return count;
  });
  const functionWarnings = useDiagnosticsStore((s) => {
    let count = 0;
    for (const diags of Object.values(s.byFunctionId)) for (const d of diags) if (d.severity === "warning") count++;
    return count;
  });

  const tabs = useMemo(() => (isDebugMode ? debugTabs : staticTabs), [isDebugMode, debugTabs, staticTabs]);

  const handleTabClick = (tabId: SidebarTab) => {
    onTabChange(activeTab === tabId ? null : tabId);
  };

  const renderTabContent = () => {
    switch (activeTab) {
      case "nodes":
        return (
          <NodeLibrary
            onAddNode={onAddNode}
            nodeDefinitions={nodeDefinitions}
            getAllCategories={getAllCategories}
            functions={functions}
            isFunctionCanvas={!!isFunctionCanvas}
          />
        );
      case "variables":
        return <VariablesPanel canvasId={canvasId} onSelectNode={onSelectNode} />;
      case "channels":
        return <ChannelsPanel />;
      case "memory":
        return <MemoryPanel />;
      case "models":
        return <ModelsPanel />;
      case "functions":
        return <FunctionListPanel onOpenFunction={onOpenFunction} onCreateFunction={onCreateFunction} />;
      case "diagnostics":
        return <DiagnosticsPanel canvasId={canvasId} onSelectNode={onSelectNode} onSelectEdge={onSelectEdge} />;
      case "debug-context":
        return <DebugContextPanel />;
      default:
        return null;
    }
  };

  const getTabLabel = (tabId: SidebarTab) => {
    const tab = tabs.find((tab) => tab.id === tabId);
    return tab?.label ?? "";
  };

  return (
    <div className="flex h-full">
      {/* Icon Rail - Always visible */}
      <div className="w-14 bg-card border-r border-border/50 flex flex-col items-center py-3 gap-1 shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          // Per-tab error/warning counts for icon coloring + badge.
          // Diagnostics tab covers nodes+edges; channels tab covers channels.
          let tabErrors = 0;
          let tabWarnings = 0;
          if (tab.id === "diagnostics") {
            tabErrors = totalErrors;
            tabWarnings = totalWarnings;
          } else if (tab.id === "channels") {
            tabErrors = channelErrors;
            tabWarnings = channelWarnings;
          } else if (tab.id === "memory") {
            tabErrors = memoryErrors;
            tabWarnings = memoryWarnings;
          } else if (tab.id === "models") {
            tabErrors = modelErrors;
            tabWarnings = modelWarnings;
          } else if (tab.id === "functions") {
            tabErrors = functionErrors;
            tabWarnings = functionWarnings;
          }
          const tabIssueCount = tabErrors + tabWarnings;
          const showBadge = tabIssueCount > 0;

          const iconColorClass =
            showBadge && !isActive
              ? tabErrors > 0
                ? "text-destructive hover:text-destructive hover:bg-destructive/10"
                : "text-warning hover:text-warning hover:bg-warning/10"
              : undefined;

          return (
            <Tooltip key={tab.id} delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    // Drop focus after a mouse click so a follow-up Enter doesn't
                    // re-fire (toggle) this tab. Keyboard activation (detail 0) keeps focus.
                    if (e.detail !== 0) e.currentTarget.blur();
                    handleTabClick(tab.id);
                  }}
                  className={cn(
                    "w-10 h-10 transition-all duration-200 relative",
                    isActive
                      ? "bg-accent text-primary shadow-sm"
                      : (iconColorClass ?? "text-muted-foreground hover:text-foreground hover:bg-accent/50"),
                  )}
                >
                  <Icon className="w-5 h-5" />
                  {showBadge && (
                    <span
                      className={cn(
                        "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full text-[10px] font-bold flex items-center justify-center px-1 shadow-sm",
                        tabErrors > 0
                          ? "bg-destructive text-destructive-foreground"
                          : "bg-warning text-warning-foreground",
                      )}
                    >
                      {tabIssueCount}
                    </span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {tab.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Content Panel - Slides in/out */}
      <div
        className={cn(
          "bg-card/95 backdrop-blur-xl border-r border-border/50 transition-all duration-300 ease-in-out overflow-hidden flex flex-col",
          activeTab ? "w-64 opacity-100" : "w-0 opacity-0",
        )}
      >
        {activeTab && (
          <>
            {/* Panel Header */}
            <div className="flex items-center justify-between p-3 border-b border-border/50 shrink-0">
              <h3 className="font-semibold text-sm text-foreground">{getTabLabel(activeTab)}</h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onTabChange(null)}
                className="w-7 h-7 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            {/* Panel Content — ScrollArea overlays the scrollbar in the panel's
                gutter so content width stays constant whether overflow is
                present or not. Padding lives on the inner viewport because the
                Root must clip cleanly for the absolute-positioned scrollbar. */}
            <ScrollArea className="flex-1" viewportClassName="p-3">
              {renderTabContent()}
            </ScrollArea>
          </>
        )}
      </div>
    </div>
  );
};
