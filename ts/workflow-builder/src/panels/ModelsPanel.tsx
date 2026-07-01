import { useTranslation } from "react-i18next";
import { BrainCircuit, Plus } from "lucide-react";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useEditorStore } from "../stores/editorStore";
import { addModel } from "../utils/modelOperations";
import { ResourceListPanel } from "./ResourceListPanel";

/**
 * Lists DECLARED custom/self-hosted models: LLM models (mapped to an llmproxy
 * provider at deploy) and ML models (served by an inference sidecar). The static
 * catalog (built-in models) is not shown here — those are always available as
 * picker options on nodes and need no declaration. This tab manages only the
 * models a workflow declares and binds at deploy.
 */
export const ModelsPanel = () => {
  const { t } = useTranslation();
  const models = useEditorStore((s) => s.models);
  const selection = useEditorStore((s) => s.selection);
  const selectModel = useEditorStore((s) => s.selectModel);
  const byModelId = useDiagnosticsStore((s) => s.byModelId);

  return (
    <ResourceListPanel
      items={Object.values(models)}
      selectedId={selection.kind === "model" ? selection.id : null}
      onSelect={selectModel}
      diagnosticsSlot={byModelId}
      badge={(m) => (m.type === "MLModel" ? t("modelMLBadge", "ML") : t("modelLLMBadge", "LLM"))}
      emptyIcon={BrainCircuit}
      emptyText={t("noModels", "No custom models yet")}
      emptyHint={t("noModelsHint", "Built-in models are always available. Declare custom or self-hosted models here.")}
      addActions={[
        { label: t("addLLMModel", "Add LLM Model"), icon: Plus, onAdd: () => selectModel(addModel("LLMModel").id) },
        { label: t("addMLModel", "Add ML Model"), icon: Plus, onAdd: () => selectModel(addModel("MLModel").id) },
      ]}
    />
  );
};
