import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { AlertTriangle, BrainCircuit, Plus } from "lucide-react";
import { cn } from "../lib/utils";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useEditorStore, isReadOnly } from "../stores/editorStore";
import { addModel } from "../utils/modelOperations";

/**
 * Lists DECLARED custom/self-hosted models. The static catalog (built-in models
 * the llmproxy supports) is not shown here — those are always available as
 * picker options on agent nodes and need no declaration. This tab only manages
 * the custom models that get mapped to llmproxy providers at deploy.
 */
export const ModelsPanel = () => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const { t } = useTranslation();
  const models = useEditorStore((s) => s.models);
  const selectedModelId = useEditorStore((s) => s.selectedModelId);
  const setSelectedModelId = useEditorStore((s) => s.setSelectedModelId);
  const byModelId = useDiagnosticsStore((s) => s.byModelId);

  const list = Object.values(models);

  const handleAdd = () => {
    const created = addModel("LLMModel");
    setSelectedModelId(created.id);
  };

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <BrainCircuit className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">{t("noModels", "No custom models yet")}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {t("noModelsHint", "Built-in models are always available. Declare custom or self-hosted models here.")}
        </p>
        {!readOnly && (
          <Button variant="outline" size="sm" className="mt-3" onClick={handleAdd}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            {t("addCustomModel", "Add Custom Model")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {list.map((model) => {
        const isSelected = selectedModelId === model.id;
        const hasError = (byModelId[model.id] ?? []).some((d) => d.severity === "error");
        return (
          <div
            key={model.id}
            onClick={() => setSelectedModelId(model.id)}
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
                {model.label}
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground shrink-0">
                {t("modelLLMBadge", "LLM")}
              </span>
            </div>
          </div>
        );
      })}
      {!readOnly && (
        <Button variant="outline" size="sm" className="w-full text-xs border-dashed" onClick={handleAdd}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          {t("addCustomModel", "Add Custom Model")}
        </Button>
      )}
    </div>
  );
};
