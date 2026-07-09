// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import { ChevronRight } from "lucide-react";
import type { FunctionDeclaration } from "@foresthubai/workflow-core/function";
import { useEditorStore } from "../stores/editorStore";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { isReadOnly } from "../mode";
import { ReadOnlyBanner } from "../components/ui/readonly-banner";
import { DeleteButton } from "../components/ui/delete-button";
import { PortSection } from "../inputs/PortSection";
import ExpressionInput from "../inputs/ExpressionInput";
import { useAvailableVariables } from "../hooks/useAvailableVariables";
import {
  renameFunction,
  addArgument,
  updateArgument,
  removeArgument,
  addOutput,
  updateOutput,
  removeOutput,
  setOutputExpression,
  deleteFunction,
} from "../utils/functionOperations";

interface FunctionConfigPanelProps {
  func: FunctionDeclaration;
  onClose: () => void;
}

/**
 * Right-side editor for a project-scoped function declaration, styled like the other
 * config panels: an editable title, then Inputs and Outputs sections (strong label +
 * description) whose rows are the same `bg-card` declaration cards the node Outputs
 * section uses. Each output bundles its declaration with the expression that produces
 * it; those expressions resolve against the function body's scope (the body canvas is
 * active, since selectFunction switched to it). Edits are non-undo-tracked.
 */
export const FunctionConfigPanel = ({ func, onClose }: FunctionConfigPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const { id, arguments: fnArgs, outputs } = func;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Local name state preserves cursor position; resets when a different function opens.
  const [localName, setLocalName] = useState(func.name);
  useEffect(() => {
    setLocalName(func.name);
  }, [id, func.name]);

  // Output expressions resolve against the function body's variable scope.
  const { lookup: availableVariables } = useAvailableVariables(id);

  // Per-output error messages come from the same byFunctionId slot that rings the
  // sidebar tab badge + list row, so panel, badge, and list always agree.
  const fnDiags = useDiagnosticsStore((s) => s.byFunctionId[id]);
  const outputErrors = useMemo(() => {
    const byUid = new Map<string, string[]>();
    for (const d of fnDiags ?? []) {
      if (!d.outputId) continue;
      const list = byUid.get(d.outputId);
      if (list) list.push(d.message);
      else byUid.set(d.outputId, [d.message]);
    }
    return byUid;
  }, [fnDiags]);

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 -mx-1.5 hover:border-input focus-within:border-input transition-colors">
              <input
                type="text"
                title={t("functionName")}
                className="font-semibold text-lg bg-transparent w-full outline-none cursor-text py-0.5 font-mono"
                value={localName}
                readOnly={readOnly}
                placeholder={t("functionNamePlaceholder")}
                onChange={(e) => {
                  setLocalName(e.target.value);
                  renameFunction(id, e.target.value);
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{t("functionDefinition")}</p>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {readOnly && <ReadOnlyBanner />}

        <div className={`space-y-4 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
          <Separator />

          <PortSection
            title={t("inputs")}
            description={t("functionInputsDesc")}
            addLabel={t("add")}
            emptyText={t("noInputs")}
            ports={fnArgs}
            onAdd={() => addArgument(id)}
            onUpdate={(index, patch) => updateArgument(id, index, patch)}
            onRemove={(index) => removeArgument(id, index)}
          />

          <Separator />

          <PortSection
            title={t("outputs")}
            description={t("functionOutputsDesc")}
            addLabel={t("add")}
            emptyText={t("noOutputs")}
            ports={outputs}
            onAdd={() => addOutput(id)}
            onUpdate={(index, patch) => updateOutput(id, index, patch)}
            onRemove={(index) => removeOutput(id, index)}
            errorsFor={(out) => outputErrors.get(out.uid) ?? []}
            renderExtra={(out, index) => (
              <ExpressionInput
                value={out.expression}
                onChange={(expr) => setOutputExpression(id, index, expr)}
                expressionType={out.dataType}
                availableVariables={availableVariables}
                placeholder={`${t("expressionFor")} ${out.name}...`}
              />
            )}
          />
        </div>

        {!readOnly && (
          <>
            <Separator />
            <DeleteButton onClick={() => setShowDeleteConfirm(true)}>{t("deleteFunction")}</DeleteButton>
          </>
        )}
      </div>

      {/* Functions carry a body + call sites, so deletion is confirmed (unlike the
          leaf resources, which delete inline). */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteFunctionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteFunctionDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                deleteFunction(id);
                setShowDeleteConfirm(false);
                onClose();
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
