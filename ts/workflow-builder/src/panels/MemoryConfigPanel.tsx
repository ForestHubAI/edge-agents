import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { ChevronRight, Trash2 } from "lucide-react";
import { MemoryRegistry, type MemoryInstance } from "@foresthub/workflow-core/memory";
import ParameterEditor from "../inputs/ParameterEditor";
import { MAIN_CANVAS_ID } from "../store/canvasStore";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { deleteMemory, updateMemory } from "../utils/memoryOperations";

interface MemoryConfigPanelProps {
  memory: MemoryInstance;
  onClose: () => void;
}

export const MemoryConfigPanel = ({ memory, onClose }: MemoryConfigPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const allMemory = useEditorStore((s) => s.memory);

  // Local label state mirrors ChannelConfigPanel — preserves cursor position on edit.
  const [localLabel, setLocalLabel] = useState(memory.label);
  useEffect(() => {
    setLocalLabel(memory.label);
  }, [memory.id]);

  const def = MemoryRegistry.getByType(memory.type);
  const parameters = def?.parameters ?? [];
  const allArguments: Record<string, unknown> = { ...memory.arguments };

  // Label doubles as the LLM tool identifier for memory files and must be unique
  // per agent. Surfaced inline below the title (mirrors the old name check).
  const isDuplicateLabel =
    memory.type === "MemoryFile" &&
    memory.label.trim() !== "" &&
    Object.values(allMemory).some(
      (m) => m.id !== memory.id && m.type === "MemoryFile" && m.label === memory.label,
    );
  const isEmptyLabel = memory.label.trim() === "";

  // Per-parameter error map, keyed by paramId — same shape ChannelConfigPanel uses.
  const memoryDiags = useDiagnosticsStore((s) => s.byMemoryId[memory.id]);
  const paramErrors = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!memoryDiags) return map;
    for (const d of memoryDiags) {
      if (d.paramId && d.severity === "error") {
        const arr = map.get(d.paramId);
        if (arr) arr.push(d.message);
        else map.set(d.paramId, [d.message]);
      }
    }
    return map;
  }, [memoryDiags]);

  const handleParamChange = (paramId: string, value: unknown) => {
    updateMemory(memory.id, { arguments: { [paramId]: value } });
  };

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 -mx-1.5 hover:border-input focus-within:border-input transition-colors">
              <input
                type="text"
                title={t("memoryLabel", "Memory label")}
                className="font-semibold text-lg bg-transparent w-full outline-none cursor-text py-0.5"
                value={localLabel}
                readOnly={readOnly}
                onChange={(e) => {
                  setLocalLabel(e.target.value);
                  updateMemory(memory.id, { label: e.target.value });
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{def?.description ?? ""}</p>
            {isEmptyLabel && (
              <p className="text-xs text-destructive mt-1">{t("memoryLabelRequired", "Label is required")}</p>
            )}
            {isDuplicateLabel && (
              <p className="text-xs text-destructive mt-1">
                {t("memoryLabelDuplicate", "Label must be unique per agent")}
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {readOnly && (
          <div className="text-xs font-medium text-muted-foreground bg-muted/50 rounded px-2 py-1">
            {t("preview.viewOnly")}
          </div>
        )}

        {parameters.length > 0 && (
          <>
            <Separator />
            <div className={`space-y-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
              {parameters.map((param) => (
                <ParameterEditor
                  key={param.id}
                  canvasId={MAIN_CANVAS_ID}
                  parameter={param}
                  value={memory.arguments[param.id]}
                  allArguments={allArguments}
                  onChange={(value) => handleParamChange(param.id, value)}
                  errors={paramErrors.get(param.id)}
                  translationPrefix="memory"
                />
              ))}
            </div>
          </>
        )}

        {!readOnly && (
          <>
            <Separator />
            <Button variant="destructive" className="w-full" onClick={() => deleteMemory(memory.id)}>
              <Trash2 className="w-4 h-4 mr-2" />
              {t("deleteMemory", "Delete memory")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
