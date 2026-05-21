import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { ChevronRight, Trash2 } from "lucide-react";
import { ModelRegistry, type ModelInstance } from "@foresthub/workflow-core/model";
import ParameterEditor from "../inputs/ParameterEditor";
import { MAIN_CANVAS_ID } from "../store/canvasStore";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { deleteModel, updateModel } from "../utils/modelOperations";

interface ModelConfigPanelProps {
  model: ModelInstance;
  onClose: () => void;
}

export const ModelConfigPanel = ({ model, onClose }: ModelConfigPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));

  // Local label state mirrors ChannelConfigPanel — preserves cursor position on edit.
  const [localLabel, setLocalLabel] = useState(model.label);
  useEffect(() => {
    setLocalLabel(model.label);
  }, [model.id]);

  const def = ModelRegistry.getByType(model.type);
  const parameters = def?.parameters ?? [];
  const allArguments: Record<string, unknown> = { ...model.arguments };

  const isEmptyLabel = model.label.trim() === "";

  // Per-parameter error map, keyed by paramId — same shape ChannelConfigPanel uses.
  const modelDiags = useDiagnosticsStore((s) => s.byModelId[model.id]);
  const paramErrors = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!modelDiags) return map;
    for (const d of modelDiags) {
      if (d.paramId && d.severity === "error") {
        const arr = map.get(d.paramId);
        if (arr) arr.push(d.message);
        else map.set(d.paramId, [d.message]);
      }
    }
    return map;
  }, [modelDiags]);

  const handleParamChange = (paramId: string, value: unknown) => {
    updateModel(model.id, { arguments: { [paramId]: value } });
  };

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 -mx-1.5 hover:border-input focus-within:border-input transition-colors">
              <input
                type="text"
                title={t("modelLabel", "Model label")}
                className="font-semibold text-lg bg-transparent w-full outline-none cursor-text py-0.5"
                value={localLabel}
                readOnly={readOnly}
                onChange={(e) => {
                  setLocalLabel(e.target.value);
                  updateModel(model.id, { label: e.target.value });
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {def?.description ?? t("modelCustomDescription", "Custom model mapped to a provider at deploy")}
            </p>
            {isEmptyLabel && (
              <p className="text-xs text-destructive mt-1">{t("modelLabelRequired", "Label is required")}</p>
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
                  value={model.arguments[param.id]}
                  allArguments={allArguments}
                  onChange={(value) => handleParamChange(param.id, value)}
                  errors={paramErrors.get(param.id)}
                  translationPrefix="models"
                />
              ))}
            </div>
          </>
        )}

        {!readOnly && (
          <>
            <Separator />
            <Button variant="destructive" className="w-full" onClick={() => deleteModel(model.id)}>
              <Trash2 className="w-4 h-4 mr-2" />
              {t("deleteModel", "Delete model")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
