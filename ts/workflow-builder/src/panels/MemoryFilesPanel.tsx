import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Database, Plus } from "lucide-react";
import { cn } from "../lib/utils";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { addMemoryFile } from "../utils/memoryFileOperations";

export const MemoryFilesPanel = () => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const { t } = useTranslation();
  const memoryFiles = useEditorStore((s) => s.memoryFiles);
  const selectedMemoryFileId = useEditorStore((s) => s.selectedMemoryFileId);
  const setSelectedMemoryFileId = useEditorStore((s) => s.setSelectedMemoryFileId);

  const list = Object.values(memoryFiles);

  const handleAdd = () => {
    const created = addMemoryFile();
    setSelectedMemoryFileId(created.uid);
  };

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Database className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">{t("noMemoryFiles", "No memory files yet")}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {t("noMemoryFilesHint", "Declare durable storage your agents can read or write")}
        </p>
        {!readOnly && (
          <Button variant="outline" size="sm" className="mt-3" onClick={handleAdd}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            {t("addMemoryFile", "Add Memory File")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {list.map((mem) => {
        const isSelected = selectedMemoryFileId === mem.uid;
        return (
          <div
            key={mem.uid}
            onClick={() => setSelectedMemoryFileId(mem.uid)}
            className={cn(
              "p-3 rounded-lg transition-all cursor-pointer",
              isSelected
                ? "bg-primary/10 border border-primary/40 ring-1 ring-primary/40 shadow-md"
                : "bg-card shadow-sm hover:shadow-md",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-foreground truncate">{mem.name}</span>
              {mem.maxSizeBytes != null && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground shrink-0">
                  {mem.maxSizeBytes}B
                </span>
              )}
            </div>
            {mem.description && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{mem.description}</p>
            )}
          </div>
        );
      })}
      {!readOnly && (
        <Button variant="outline" size="sm" className="w-full text-xs border-dashed" onClick={handleAdd}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          {t("addMemoryFile", "Add Memory File")}
        </Button>
      )}
    </div>
  );
};
