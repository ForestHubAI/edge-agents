import { useTranslation } from "react-i18next";
import { Database, FileText } from "lucide-react";
import type { MemoryType } from "@foresthubai/workflow-core/memory";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useEditorStore } from "../stores/editorStore";
import { addMemory } from "../utils/memoryOperations";
import { ResourceListPanel } from "./ResourceListPanel";

/** Short, friendly badge label per memory type (the raw type names are long). */
const TYPE_BADGE: Record<MemoryType, string> = {
  MemoryFile: "File",
  VectorDatabase: "Vector",
};

export const MemoryPanel = () => {
  const { t } = useTranslation();
  const memory = useEditorStore((s) => s.memory);
  const selection = useEditorStore((s) => s.selection);
  const selectMemory = useEditorStore((s) => s.selectMemory);
  const byMemoryId = useDiagnosticsStore((s) => s.byMemoryId);

  const add = (type: MemoryType) => selectMemory(addMemory(type).id);

  return (
    <ResourceListPanel
      items={Object.values(memory)}
      selectedId={selection.kind === "memory" ? selection.id : null}
      onSelect={selectMemory}
      diagnosticsSlot={byMemoryId}
      badge={(m) => TYPE_BADGE[m.type]}
      emptyIcon={Database}
      emptyText={t("noMemory", "No memory declared yet")}
      emptyHint={t("noMemoryHint", "Declare memory files for agents and vector databases for RAG")}
      addActions={[
        { label: t("addMemoryFile", "Add Memory File"), icon: FileText, onAdd: () => add("MemoryFile") },
        { label: t("addVectorDatabase", "Add Vector Database"), icon: Database, onAdd: () => add("VectorDatabase") },
      ]}
    />
  );
};
