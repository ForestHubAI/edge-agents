import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { ChevronRight, Trash2 } from "lucide-react";
import type { MemoryFileInstance } from "@foresthub/workflow-core/memory";
import { MEMORY_FILE_DEFINITION } from "@foresthub/workflow-core/memory";
import ParameterEditor from "../inputs/ParameterEditor";
import { MAIN_CANVAS_ID } from "../store/canvasStore";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { deleteMemoryFile, updateMemoryFile } from "../utils/memoryFileOperations";

interface MemoryFileConfigPanelProps {
  memoryFile: MemoryFileInstance;
  onClose: () => void;
}

export const MemoryFileConfigPanel = ({ memoryFile, onClose }: MemoryFileConfigPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const memoryFiles = useEditorStore((s) => s.memoryFiles);

  // Local-state mirror keeps the title field's cursor stable across keystrokes.
  const [localName, setLocalName] = useState(memoryFile.name);
  useEffect(() => {
    setLocalName(memoryFile.name);
  }, [memoryFile.uid]);

  // The name field doubles as both the panel header and the `name` parameter,
  // so we render it inline above the parameter list (same pattern channels use
  // for `label`) and drop it from the ParameterEditor loop below.
  const parameters = MEMORY_FILE_DEFINITION.parameters.filter((p) => p.id !== "name");
  const allArguments: Record<string, unknown> = {
    name: memoryFile.name,
    description: memoryFile.description,
    content: memoryFile.content,
    maxSizeBytes: memoryFile.maxSizeBytes,
  };

  // Duplicate-name check across the agent (excluding this row). Surfaced
  // inline below the title; the diagnostic store isn't wired for memory yet.
  const isDuplicateName =
    memoryFile.name.trim() !== "" &&
    Object.values(memoryFiles).some((m) => m.uid !== memoryFile.uid && m.name === memoryFile.name);
  const isEmptyName = memoryFile.name.trim() === "";

  const handleParamChange = (paramId: string, value: unknown) => {
    updateMemoryFile(memoryFile.uid, { [paramId]: value });
  };

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 -mx-1.5 hover:border-input focus-within:border-input transition-colors">
              <input
                type="text"
                title={t("builder.memoryFileName", "Memory file name")}
                className="font-semibold text-lg bg-transparent w-full outline-none cursor-text py-0.5"
                value={localName}
                readOnly={readOnly}
                onChange={(e) => {
                  setLocalName(e.target.value);
                  updateMemoryFile(memoryFile.uid, { name: e.target.value });
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("builder.memoryFileDescription", "Agent-scoped durable storage")}
            </p>
            {isEmptyName && (
              <p className="text-xs text-destructive mt-1">
                {t("builder.memoryFileNameRequired", "Name is required")}
              </p>
            )}
            {isDuplicateName && (
              <p className="text-xs text-destructive mt-1">
                {t("builder.memoryFileNameDuplicate", "Name must be unique per agent")}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {readOnly && (
          <div className="text-xs font-medium text-muted-foreground bg-muted/50 rounded px-2 py-1">
            {t("builder.preview.viewOnly")}
          </div>
        )}

        <Separator />
        <div className={`space-y-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
          {parameters.map((param) => (
            <ParameterEditor
              key={param.id}
              canvasId={MAIN_CANVAS_ID}
              parameter={param}
              value={allArguments[param.id]}
              allArguments={allArguments}
              onChange={(value) => handleParamChange(param.id, value)}
              translationPrefix="memoryFiles"
            />
          ))}
        </div>

        {!readOnly && (
          <>
            <Separator />
            <Button variant="destructive" className="w-full" onClick={() => deleteMemoryFile(memoryFile.uid)}>
              <Trash2 className="w-4 h-4 mr-2" />
              {t("builder.deleteMemoryFile", "Delete memory file")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
