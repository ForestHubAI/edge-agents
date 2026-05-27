import { useTranslation } from "react-i18next";
import { BrainCircuit, Plus } from "lucide-react";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useEditorStore } from "../stores/editorStore";
import { addModel } from "../utils/modelOperations";
import { ResourceListPanel } from "./ResourceListPanel";

/**
 * Lists DECLARED custom/self-hosted models. The static catalog (built-in models
 * the llmproxy supports) is not shown here — those are always available as
 * picker options on agent nodes and need no declaration. This tab only manages
 * the custom models that get mapped to llmproxy providers at deploy.
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
      badge={() => t("modelLLMBadge", "LLM")}
      emptyIcon={BrainCircuit}
      emptyText={t("noModels", "No custom models yet")}
      emptyHint={t("noModelsHint", "Built-in models are always available. Declare custom or self-hosted models here.")}
      addActions={[
        { label: t("addCustomModel", "Add Custom Model"), icon: Plus, onAdd: () => selectModel(addModel("LLMModel").id) },
      ]}
    />
  );
};
