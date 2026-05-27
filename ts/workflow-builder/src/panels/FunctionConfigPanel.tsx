import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/label";
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
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import type { FunctionDeclaration } from "@foresthubai/workflow-core/function";
import { useEditorStore } from "../stores/editorStore";
import { isReadOnly } from "../WorkflowBuilder";
import { ReadOnlyBanner } from "../components/ui/readonly-banner";
import { DeleteButton } from "../components/ui/delete-button";
import { PortSection, VariableEditor } from "../inputs/PortSection";
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
 * Right-side editor for a project-scoped function declaration: name, the input
 * argument list, and the output list — each output bundling its declaration
 * (name/dataType) with the expression that produces it. The function's body lives on
 * its canvas, which is active (selectFunction switched to it), so the output
 * expressions resolve against the body's local variable scope. Edits are
 * non-undo-tracked (functionOperations write straight to editorStore).
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

        <div className={readOnly ? "pointer-events-none opacity-60" : ""}>
          <Separator />

          {/* Inputs — plain declarations (name + dataType). */}
          <PortSection
            ports={fnArgs}
            direction="input"
            onAdd={() => addArgument(id)}
            onUpdate={(index, patch) => updateArgument(id, index, patch)}
            onRemove={(index) => removeArgument(id, index)}
            maxHeight="10rem"
          />

          <Separator />

          {/* Outputs — each row bundles the declaration with its return expression. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2 text-sm font-medium">
                <ArrowLeft className="w-4 h-4 text-node-output" />
                {t("outputs")}
              </Label>
              <Button variant="ghost" size="sm" onClick={() => addOutput(id)} className="h-7 px-2 text-xs">
                <Plus className="w-3 h-3 mr-1" />
                {t("add")}
              </Button>
            </div>

            {outputs.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">{t("noOutputs")}</p>
            ) : (
              <div className="space-y-3">
                {outputs.map((out, index) => (
                  <div key={out.uid} className="space-y-1.5 rounded-lg border border-border/50 bg-accent/20 p-2">
                    <VariableEditor
                      variable={out}
                      onUpdate={(patch) => updateOutput(id, index, patch)}
                      onRemove={() => removeOutput(id, index)}
                    />
                    <ExpressionInput
                      value={out.expression}
                      onChange={(expr) => setOutputExpression(id, index, expr)}
                      expressionType={out.dataType}
                      availableVariables={availableVariables}
                      placeholder={`${t("expressionFor")} ${out.name}...`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
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
