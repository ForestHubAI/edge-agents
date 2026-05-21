import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { useTranslation } from "react-i18next";
import { useDebugStore } from "../stores/debugStore";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../stores/canvasStore";
import type { DataType } from "@foresthub/workflow-core/node";

interface VariableEntry {
  key: string;
  name: string;
  dataType: DataType;
}

/** Build the list of editable variables from the main canvas store. */
function getVariableEntries(): VariableEntry[] {
  const variables = getOrCreateCanvasStore(MAIN_CANVAS_ID).getState().variables;
  const entries: VariableEntry[] = [];
  for (const v of Object.values(variables)) {
    if (v.kind === "declared" || v.kind === "node") {
      entries.push({ key: v.name, name: v.name, dataType: v.dataType });
    }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

export const DebugContextPanel = () => {
  const { t } = useTranslation();
  const context = useDebugStore((s) => s.context);
  const updateContextVar = useDebugStore((s) => s.updateContextVar);
  const entries = getVariableEntries();

  if (entries.length === 0) {
    return <div className="text-sm text-muted-foreground text-center py-4">{t("debug.noVariables")}</div>;
  }

  return (
    <div className="space-y-3">
      {entries.map(({ key, name, dataType }) => {
        const value = context[key];
        return (
          <div key={key} className="space-y-1">
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <span>{name}</span>
              <span className="text-muted-foreground font-mono">({dataType})</span>
            </Label>
            {dataType === "bool" ? (
              <Switch checked={!!value} onCheckedChange={(checked) => updateContextVar(key, checked)} />
            ) : dataType === "int" ? (
              <Input
                type="number"
                step={1}
                value={(value as number) ?? 0}
                onChange={(e) => updateContextVar(key, parseInt(e.target.value) || 0)}
                className="h-8 font-mono text-sm"
              />
            ) : dataType === "float" ? (
              <Input
                type="number"
                step={0.1}
                value={(value as number) ?? 0}
                onChange={(e) => updateContextVar(key, parseFloat(e.target.value) || 0)}
                className="h-8 font-mono text-sm"
              />
            ) : (
              <Input
                value={String(value ?? "")}
                onChange={(e) => updateContextVar(key, e.target.value)}
                className="h-8 font-mono text-sm"
              />
            )}
          </div>
        );
      })}
    </div>
  );
};
