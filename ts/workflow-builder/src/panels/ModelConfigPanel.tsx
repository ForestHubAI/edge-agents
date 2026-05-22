import { useTranslation } from "react-i18next";
import { ModelRegistry, type Model } from "@foresthub/workflow-core/model";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { deleteModel, updateModel } from "../utils/modelOperations";
import { ResourceConfigPanel } from "./ResourceConfigPanel";

interface ModelConfigPanelProps {
  model: Model;
  onClose: () => void;
}

export const ModelConfigPanel = ({ model, onClose }: ModelConfigPanelProps) => {
  const { t } = useTranslation();
  const def = ModelRegistry.getByType(model.type);
  const modelDiags = useDiagnosticsStore((s) => s.byModelId[model.id]);
  const isEmptyLabel = model.label.trim() === "";

  return (
    <ResourceConfigPanel
      resetKey={model.id}
      label={model.label}
      labelTitle={t("modelLabel", "Model label")}
      onLabelChange={(label) => updateModel(model.id, { label })}
      description={def?.description ?? t("modelCustomDescription", "Custom model mapped to a provider at deploy")}
      belowLabel={
        isEmptyLabel ? (
          <p className="text-xs text-destructive mt-1">{t("modelLabelRequired", "Label is required")}</p>
        ) : undefined
      }
      parameters={def?.parameters ?? []}
      getValue={(p) => model.arguments[p.id]}
      allArguments={{ ...model.arguments }}
      onParamChange={(paramId, value) => updateModel(model.id, { arguments: { [paramId]: value } })}
      diagnostics={modelDiags}
      translationPrefix="models"
      deleteLabel={t("deleteModel", "Delete model")}
      onDelete={() => deleteModel(model.id)}
      onClose={onClose}
    />
  );
};
