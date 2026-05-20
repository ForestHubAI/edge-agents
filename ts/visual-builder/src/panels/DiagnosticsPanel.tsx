import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../components/ui/badge";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { getOrCreateCanvasStore } from "../store/canvasStore";
import { useNodeDefinitions } from "../hooks/useNodeDefinitions";
import type { Diagnostic } from "@foresthub/workflow-core/diagnostics";

interface DiagnosticsPanelProps {
  canvasId: string;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

interface DiagnosticGroup {
  entityId: string;
  entityType: "node" | "edge";
  label: string;
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
}

export const DiagnosticsPanel = ({ canvasId, onSelectNode, onSelectEdge }: DiagnosticsPanelProps) => {
  const { t } = useTranslation();
  const { getNodeDefinition } = useNodeDefinitions();

  const byNodeId = useDiagnosticsStore((s) => s.byNodeId);
  const byEdgeId = useDiagnosticsStore((s) => s.byEdgeId);
  const useCanvasStore = getOrCreateCanvasStore(canvasId);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  // Build groups
  const groups: DiagnosticGroup[] = [];

  // Node groups
  for (const [nodeId, diags] of Object.entries(byNodeId)) {
    if (diags.length === 0) continue;
    const node = nodes.find((n) => n.id === nodeId);
    const nodeDef = node ? getNodeDefinition(node.data) : undefined;
    const label = (node?.data?.label as string) || nodeDef?.label || nodeId;
    groups.push({
      entityId: nodeId,
      entityType: "node",
      label,
      diagnostics: diags,
      errorCount: diags.filter((d) => d.severity === "error").length,
      warningCount: diags.filter((d) => d.severity === "warning").length,
    });
  }

  // Edge groups
  for (const [edgeId, diags] of Object.entries(byEdgeId)) {
    if (diags.length === 0) continue;
    const edge = edges.find((e) => e.id === edgeId);
    const sourceNode = edge ? nodes.find((n) => n.id === edge.source) : undefined;
    const targetNode = edge ? nodes.find((n) => n.id === edge.target) : undefined;
    const sourceDef = sourceNode ? getNodeDefinition(sourceNode.data) : undefined;
    const targetDef = targetNode ? getNodeDefinition(targetNode.data) : undefined;
    const sourceLabel = (sourceNode?.data?.label as string) || sourceDef?.label || "?";
    const targetLabel = (targetNode?.data?.label as string) || targetDef?.label || "?";
    const label = `${sourceLabel} → ${targetLabel}`;
    groups.push({
      entityId: edgeId,
      entityType: "edge",
      label,
      diagnostics: diags,
      errorCount: diags.filter((d) => d.severity === "error").length,
      warningCount: diags.filter((d) => d.severity === "warning").length,
    });
  }

  // IO variable diagnostics are surfaced on the IO sidebar tab itself
  // (red ring on cards + count badge on the tab icon) — not duplicated here.

  // Sort: errors first, then warnings; within same severity, nodes before edges;
  // within same type, alphabetical by label so the panel order stays stable
  // regardless of which nodes ReactFlow currently has mounted (virtualization
  // can reshuffle the diagnostics store's insertion order on pan/select).
  groups.sort((a, b) => {
    const aHasError = a.errorCount > 0 ? 0 : 1;
    const bHasError = b.errorCount > 0 ? 0 : 1;
    if (aHasError !== bHasError) return aHasError - bHasError;
    const aType = a.entityType === "node" ? 0 : 1;
    const bType = b.entityType === "node" ? 0 : 1;
    if (aType !== bType) return aType - bType;
    return a.label.localeCompare(b.label);
  });

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <CheckCircle2 className="w-8 h-8 text-success" />
        <span className="text-sm">{t("builder.noIssuesFound")}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {groups.map((group) => (
        <DiagnosticGroupItem
          key={`${group.entityType}-${group.entityId}`}
          group={group}
          onSelect={() =>
            group.entityType === "node" ? onSelectNode(group.entityId) : onSelectEdge(group.entityId)
          }
        />
      ))}
    </div>
  );
};

function DiagnosticGroupItem({ group, onSelect }: { group: DiagnosticGroup; onSelect: () => void }) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          onSelect();
        }}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md hover:bg-muted/50 text-left text-sm"
      >
        <ChevronDown className={cn("w-3.5 h-3.5 shrink-0 transition-transform", !open && "-rotate-90")} />
        <span className="truncate flex-1 font-medium">{group.label}</span>
        <div className="flex items-center gap-1">
          {group.errorCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 leading-4 border-destructive/40 text-destructive bg-destructive/10">
              {group.errorCount}
            </Badge>
          )}
          {group.warningCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 leading-4 border-warning/40 text-warning bg-warning/10">
              {group.warningCount}
            </Badge>
          )}
        </div>
      </button>
      {open && (
        <div className="ml-3 border-l border-border/50 pl-2 flex flex-col gap-0.5 pb-1">
          {group.diagnostics.map((diag, i) => (
            <button
              key={i}
              type="button"
              onClick={onSelect}
              className="flex items-start gap-1.5 px-2 py-1 rounded text-xs text-left hover:bg-muted/50 transition-colors w-full"
            >
              {diag.severity === "error" ? (
                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
              )}
              <span className="text-muted-foreground">{diag.message}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
