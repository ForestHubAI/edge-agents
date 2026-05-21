import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Variable as VariableIcon, Hash, ToggleLeft, Type, List, FileJson, Plus } from "lucide-react";
import { cn } from "../lib/utils";
import { useEditorStore, isReadOnly } from "../stores/editorStore";
import { useAvailableVariables } from "../hooks/useAvailableVariables";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../stores/canvasStore";
import { type Variable, type DeclaredVariable } from "@foresthub/workflow-core/variable";
import { addDeclaredVariable } from "../utils/variableOperations";

interface VariablesPanelProps {
  canvasId: string;
  onSelectNode: (nodeId: string) => void;
}

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  String: Type,
  Int: Hash,
  Float: Hash,
  Bool: ToggleLeft,
  array: List,
  object: FileJson,
  any: VariableIcon,
};

const typeColors: Record<string, string> = {
  String: "text-type-string",
  Int: "text-type-int",
  Float: "text-type-float",
  Bool: "text-type-bool",
  array: "text-type-array",
  object: "text-type-object",
  any: "text-type-any",
};

export const VariablesPanel = ({ canvasId, onSelectNode }: VariablesPanelProps) => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const { t } = useTranslation();
  const { list: variables } = useAvailableVariables(canvasId);
  const selectedVariableUid = useEditorStore((s) => s.selectedVariableUid);
  const setSelectedVariableUid = useEditorStore((s) => s.setSelectedVariableUid);

  const store = getOrCreateCanvasStore(canvasId);
  const allVariables = store((s) => s.variables);
  const isMainCanvas = canvasId === MAIN_CANVAS_ID;

  // Extract declared variables from the unified record
  const declaredVariables = React.useMemo(() => {
    const result: { uid: string; var: DeclaredVariable }[] = [];
    for (const v of Object.values(allVariables)) {
      if (v.kind === "declared") {
        result.push({ uid: v.uid, var: v });
      }
    }
    return result;
  }, [allVariables]);

  // Create a declared variable and immediately open its config panel.
  const handleAddVariable = () => {
    const uid = addDeclaredVariable(canvasId);
    setSelectedVariableUid(uid);
  };

  // Filter variables into groups (each canvas is self-contained — no main-canvas leakage)
  const functionArgs = variables.filter((v) => v.kind === "fnarg");
  const nodeOutputs = variables.filter((v) => v.kind === "node");

  const hasContent = functionArgs.length > 0 || nodeOutputs.length > 0 || declaredVariables.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <VariableIcon className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">{t("noVariables")}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">{t("addNodesForVariables")}</p>
        {!readOnly && (
          <Button variant="outline" size="sm" className="mt-3" onClick={handleAddVariable}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            {t("addVariable")}
          </Button>
        )}
      </div>
    );
  }

  const renderVariableItem = (ref: Variable, onClick?: () => void, isSelected = false) => {
    const TypeIcon = typeIcons[ref.dataType] || VariableIcon;
    const typeColor = typeColors[ref.dataType] || typeColors.any;
    const clickable = !!onClick;

    return (
      <div
        key={
          ref.kind === "node"
            ? `${ref.nodeId}-${ref.outputId}`
            : ref.kind === "declared"
              ? `declared-${ref.uid}`
              : `fnarg-${ref.uid}`
        }
        onClick={onClick}
        className={cn(
          "p-3 rounded-lg transition-all",
          isSelected ? "bg-primary/10 shadow-md border border-primary/40 ring-1 ring-primary/40" : "bg-card shadow-sm",
          clickable ? "hover:shadow-md cursor-pointer" : "cursor-default",
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TypeIcon className={cn("w-4 h-4", typeColor)} />
            <span className="font-mono text-sm text-foreground">{ref.name}</span>
          </div>
          <span className="text-xs text-muted-foreground">{ref.dataType}</span>
        </div>
      </div>
    );
  };

  const SectionHeader = ({ title }: { title: string }) => (
    <div className="flex items-center justify-between px-1 mb-2">
      <span className="text-sm font-medium text-foreground/80">{title}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Function Arguments (function canvas only) — read-only, arrive by value */}
      {!isMainCanvas && functionArgs.length > 0 && (
        <div>
          <SectionHeader title={t("functionArguments")} />
          <div className="space-y-1.5">{functionArgs.map((v) => renderVariableItem(v))}</div>
        </div>
      )}

      {/* Node Output Variables — click opens the emitting node */}
      {nodeOutputs.length > 0 && (
        <div>
          <SectionHeader title={t("nodeOutputVariables")} />
          <div className="space-y-1.5">
            {nodeOutputs.map((v) =>
              renderVariableItem(v, v.kind === "node" ? () => onSelectNode(v.nodeId) : undefined),
            )}
          </div>
        </div>
      )}

      {/* Defined Variables — click opens the VariableConfigPanel */}
      <div>
        <SectionHeader title={t("definedVariables")} />
        <div className="space-y-1.5">
          {declaredVariables.map(({ uid, var: dv }) =>
            renderVariableItem(
              dv,
              readOnly ? undefined : () => setSelectedVariableUid(uid),
              selectedVariableUid === uid,
            ),
          )}
          {!readOnly && (
            <Button variant="outline" size="sm" className="w-full text-xs border-dashed" onClick={handleAddVariable}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              {t("addVariable")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
