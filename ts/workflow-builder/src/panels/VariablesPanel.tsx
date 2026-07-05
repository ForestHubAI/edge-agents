// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import React from "react";
import { useTranslation } from "react-i18next";
import { AddButton } from "../components/ui/add-button";
import { Variable as VariableIcon } from "lucide-react";
import { cn } from "../cn";
import { useEditorStore } from "../stores/editorStore";
import { isReadOnly } from "../WorkflowBuilder";
import { useAvailableVariables } from "../hooks/useAvailableVariables";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../stores/canvasStore";
import { type Variable, type DeclaredVariable } from "@foresthubai/workflow-core/variable";
import { addDeclaredVariable } from "../utils/variableOperations";

interface VariablesPanelProps {
  canvasId: string;
  onSelectNode: (nodeId: string) => void;
}

export const VariablesPanel = ({ canvasId, onSelectNode }: VariablesPanelProps) => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const { t } = useTranslation();
  const { list: variables } = useAvailableVariables(canvasId);
  const selection = useEditorStore((s) => s.selection);
  const selectVariable = useEditorStore((s) => s.selectVariable);

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
    selectVariable(uid);
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
          <div className="mt-3 w-full px-2">
            <AddButton onClick={handleAddVariable}>{t("addVariable")}</AddButton>
          </div>
        )}
      </div>
    );
  }

  const renderVariableItem = (ref: Variable, onClick?: () => void, isSelected = false) => {
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
          isSelected
            ? "bg-accent shadow-md border border-primary/40 ring-1 ring-primary/40"
            : "bg-card shadow-sm border border-border",
          clickable ? "hover:shadow-md cursor-pointer" : "cursor-default",
        )}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VariableIcon className="w-4 h-4 text-muted-foreground" />
            <span className="font-mono text-sm text-foreground">{ref.name}</span>
          </div>
          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground shrink-0">
            {ref.dataType}
          </span>
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
              readOnly ? undefined : () => selectVariable(uid),
              selection.kind === "variable" && selection.uid === uid,
            ),
          )}
          {!readOnly && <AddButton onClick={handleAddVariable}>{t("addVariable")}</AddButton>}
        </div>
      </div>
    </div>
  );
};
