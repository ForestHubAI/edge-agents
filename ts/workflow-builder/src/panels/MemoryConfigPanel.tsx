import { useTranslation } from "react-i18next";
import { MemoryRegistry, type Memory } from "@foresthubai/workflow-core/memory";
import { useEditorStore } from "../stores/editorStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { deleteMemory, updateMemory } from "../utils/memoryOperations";
import { ResourceConfigPanel } from "./ResourceConfigPanel";

interface MemoryConfigPanelProps {
  memory: Memory;
  onClose: () => void;
}

export const MemoryConfigPanel = ({ memory, onClose }: MemoryConfigPanelProps) => {
  const { t } = useTranslation();
  const allMemory = useEditorStore((s) => s.memory);
  const def = MemoryRegistry.getByType(memory.type);
  const memoryDiags = useDiagnosticsStore((s) => s.byMemoryId[memory.id]);

  // Label doubles as the LLM tool identifier for memory files and must be unique
  // per agent. Surfaced inline below the title (mirrors the old name check).
  const isDuplicateLabel =
    memory.type === "MemoryFile" &&
    memory.label.trim() !== "" &&
    Object.values(allMemory).some((m) => m.id !== memory.id && m.type === "MemoryFile" && m.label === memory.label);
  const isEmptyLabel = memory.label.trim() === "";

  const belowLabel = (
    <>
      {isEmptyLabel && <p className="text-xs text-destructive mt-1">{t("memoryLabelRequired", "Label is required")}</p>}
      {isDuplicateLabel && (
        <p className="text-xs text-destructive mt-1">{t("memoryLabelDuplicate", "Label must be unique per agent")}</p>
      )}
    </>
  );

  return (
    <ResourceConfigPanel
      resetKey={memory.id}
      label={memory.label}
      labelTitle={t("memoryLabel", "Memory label")}
      onLabelChange={(label) => updateMemory(memory.id, { label })}
      description={def?.description ?? ""}
      belowLabel={belowLabel}
      parameters={def?.parameters ?? []}
      getValue={(p) => memory.arguments[p.id]}
      allArguments={{ ...memory.arguments }}
      onParamChange={(paramId, value) => updateMemory(memory.id, { arguments: { [paramId]: value } })}
      diagnostics={memoryDiags}
      translationPrefix="memory"
      deleteLabel={t("deleteMemory", "Delete memory")}
      onDelete={() => deleteMemory(memory.id)}
      onClose={onClose}
    />
  );
};
