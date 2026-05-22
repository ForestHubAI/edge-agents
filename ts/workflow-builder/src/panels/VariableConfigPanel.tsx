import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ChevronRight } from "lucide-react";
import type { DeclaredVariable } from "@foresthub/workflow-core/variable";
import type { DataType } from "@foresthub/workflow-core/node";
import { useEditorStore, isReadOnly } from "../stores/editorStore";
import { ReadOnlyBanner } from "../components/ui/readonly-banner";
import { DeleteButton } from "../components/ui/delete-button";
import { deleteDeclaredVariable, setDeclaredVariableType, updateDeclaredVariable } from "../utils/variableOperations";

interface VariableConfigPanelProps {
  canvasId: string;
  variable: DeclaredVariable;
  onClose: () => void;
}

const DATA_TYPES: DataType[] = ["int", "float", "bool", "string"];

export const VariableConfigPanel = ({ canvasId, variable, onClose }: VariableConfigPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));

  // Local name state mirrors the other config panels — preserves cursor position
  // while typing and resets when a different variable is opened.
  const [localName, setLocalName] = useState(variable.name);
  useEffect(() => {
    setLocalName(variable.name);
  }, [variable.uid]);

  const isEmptyName = variable.name.trim() === "";

  // The initial-value widget is chosen by dataType: declared variables store
  // `initialValue?: unknown` and the type is enforced here at the input layer,
  // not in the data model (untyped DOM input + JSON round-trip would defeat a
  // discriminated union). Switching dataType clears the value.
  const renderInitialValueInput = () => {
    switch (variable.dataType) {
      case "bool":
        return (
          <Select
            value={variable.initialValue != null ? String(variable.initialValue) : "false"}
            onValueChange={(v) => updateDeclaredVariable(canvasId, variable.uid, { initialValue: v === "true" })}
          >
            <SelectTrigger className="h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">false</SelectItem>
              <SelectItem value="true">true</SelectItem>
            </SelectContent>
          </Select>
        );
      case "string":
        return (
          <Input
            className="h-8 text-sm"
            value={(variable.initialValue as string) ?? ""}
            onChange={(e) => updateDeclaredVariable(canvasId, variable.uid, { initialValue: e.target.value })}
            placeholder='""'
          />
        );
      case "int":
      case "float":
        return (
          <Input
            type="number"
            step={variable.dataType === "float" ? "any" : 1}
            className="h-8 text-sm"
            value={variable.initialValue != null ? Number(variable.initialValue) : ""}
            onChange={(e) => {
              const num = variable.dataType === "float" ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
              updateDeclaredVariable(canvasId, variable.uid, { initialValue: isNaN(num) ? undefined : num });
            }}
            placeholder="0"
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 -mx-1.5 hover:border-input focus-within:border-input transition-colors">
              <input
                type="text"
                title={t("variableName", "Variable name")}
                className="font-semibold text-lg font-mono bg-transparent w-full outline-none cursor-text py-0.5"
                value={localName}
                readOnly={readOnly}
                onChange={(e) => {
                  setLocalName(e.target.value);
                  updateDeclaredVariable(canvasId, variable.uid, { name: e.target.value });
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("variableDescription", "A declared variable you can read and write across this canvas")}
            </p>
            {isEmptyName && (
              <p className="text-xs text-destructive mt-1">{t("variableNameRequired", "Name is required")}</p>
            )}
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {readOnly && <ReadOnlyBanner />}

        <Separator />

        <div className={`space-y-4 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80">{t("dataType", "Data type")}</label>
            <Select
              value={variable.dataType}
              onValueChange={(v) => setDeclaredVariableType(canvasId, variable.uid, v as DataType)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATA_TYPES.map((dt) => (
                  <SelectItem key={dt} value={dt}>
                    {dt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground/80">
              {t("initialValue")}{" "}
              <span className="font-normal text-muted-foreground">({t("optional", "optional")})</span>
            </label>
            {renderInitialValueInput()}
          </div>
        </div>

        {!readOnly && (
          <>
            <Separator />
            <DeleteButton onClick={() => deleteDeclaredVariable(canvasId, variable.uid)}>
              {t("deleteVariable", "Delete variable")}
            </DeleteButton>
          </>
        )}
      </div>
    </div>
  );
};
