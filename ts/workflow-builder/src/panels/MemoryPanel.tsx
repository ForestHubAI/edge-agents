import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { AlertTriangle, Database, FileText, Plus } from "lucide-react";
import type { MemoryType } from "@foresthub/workflow-core/memory";
import { cn } from "../lib/utils";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { addMemory } from "../utils/memoryOperations";

/** Short, friendly badge label per memory type (the raw type names are long). */
const TYPE_BADGE: Record<MemoryType, string> = {
  MemoryFile: "File",
  VectorDatabase: "Vector",
};

export const MemoryPanel = () => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const { t } = useTranslation();
  const memory = useEditorStore((s) => s.memory);
  const selectedMemoryId = useEditorStore((s) => s.selectedMemoryId);
  const setSelectedMemoryId = useEditorStore((s) => s.setSelectedMemoryId);
  const byMemoryId = useDiagnosticsStore((s) => s.byMemoryId);

  const list = Object.values(memory);

  const handleAdd = (type: MemoryType) => {
    const created = addMemory(type);
    setSelectedMemoryId(created.id);
  };

  const addButtons = (
    <div className="flex flex-col gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs border-dashed"
        onClick={() => handleAdd("MemoryFile")}
      >
        <FileText className="w-3.5 h-3.5 mr-1" />
        {t("addMemoryFile", "Add Memory File")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-xs border-dashed"
        onClick={() => handleAdd("VectorDatabase")}
      >
        <Database className="w-3.5 h-3.5 mr-1" />
        {t("addVectorDatabase", "Add Vector Database")}
      </Button>
    </div>
  );

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Database className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">{t("noMemory", "No memory declared yet")}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {t("noMemoryHint", "Declare memory files for agents and vector databases for RAG")}
        </p>
        {!readOnly && <div className="mt-3 w-full px-2">{addButtons}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {list.map((mem) => {
        const isSelected = selectedMemoryId === mem.id;
        const hasError = (byMemoryId[mem.id] ?? []).some((d) => d.severity === "error");
        return (
          <div
            key={mem.id}
            onClick={() => setSelectedMemoryId(mem.id)}
            className={cn(
              "p-3 rounded-lg transition-all cursor-pointer",
              isSelected
                ? "bg-primary/10 shadow-md border border-primary/40 ring-1 ring-primary/40"
                : hasError
                  ? "bg-card shadow-sm border border-destructive ring-1 ring-destructive"
                  : "bg-card shadow-sm hover:shadow-md",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-foreground truncate flex items-center gap-1.5">
                {hasError && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                {mem.label}
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground shrink-0">
                {TYPE_BADGE[mem.type]}
              </span>
            </div>
          </div>
        );
      })}
      {!readOnly && <div className="pt-1">{addButtons}</div>}
    </div>
  );
};
