import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
import { Trash2 } from "lucide-react";
import type { Expression, FunctionInfo, Variable, NodeOutput } from "@foresthub/workflow-core/node";
import { getOrCreateCanvasStore, syncFunctionArgVariables } from "../store/canvasStore";
import type { OutputAssignments } from "../store/canvasStore";
import { useAvailableVariables } from "../hooks/useAvailableVariables";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { PortSection } from "../dialogs/FunctionInfoDialog";
import ExpressionInput from "../inputs/ExpressionInput";

interface FunctionDefinitionPanelProps {
  canvasId: string;
  onDeleteFunction: () => void;
  onRenameFunction: (newName: string) => void;
}

export const FunctionDefinitionPanel = ({
  canvasId,
  onDeleteFunction,
  onRenameFunction,
}: FunctionDefinitionPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const canvasStore = getOrCreateCanvasStore(canvasId);

  // Subscribe to canvas store state
  const functionInfo = canvasStore((s) => s.functionInfo);
  const outputAssignments = canvasStore((s) => s.outputAssignments);

  // Get available variables for expression inputs (from current canvas)
  const { lookup: availableVariables } = useAvailableVariables(canvasId);

  // Update function info with checkpoint for undo/redo
  const updateFunctionInfo = useCallback(
    (updater: (info: FunctionInfo) => FunctionInfo) => {
      if (!canvasStore || !functionInfo) return;
      canvasStore.takeCheckpoint();
      canvasStore.getState().setFunctionInfo((info) => {
        if (!info) return info;
        const updated = updater(info);
        // Increment version on any definition change
        return { ...updated, version: info.version + 1 };
      });
      // Sync fnarg variables after updating functionInfo
      syncFunctionArgVariables(canvasStore, canvasStore.getState().functionInfo);
    },
    [canvasStore, functionInfo],
  );

  // Update output assignments with checkpoint
  const updateOutputAssignments = useCallback(
    (updater: (assignments: OutputAssignments) => OutputAssignments) => {
      if (!canvasStore) return;
      canvasStore.takeCheckpoint();
      canvasStore.getState().setOutputAssignments(updater);
    },
    [canvasStore],
  );

  // Name change handler
  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newName = e.target.value;
      updateFunctionInfo((info) => ({ ...info, name: newName }));
      onRenameFunction(newName);
    },
    [updateFunctionInfo, onRenameFunction],
  );

  // Port management
  const addArgument = useCallback(() => {
    updateFunctionInfo((info) => ({
      ...info,
      arguments: [
        ...info.arguments,
        { uid: crypto.randomUUID(), name: `input${info.arguments.length + 1}`, dataType: "string" },
      ],
    }));
  }, [updateFunctionInfo]);

  const addReturnValue = useCallback(() => {
    updateFunctionInfo((info) => ({
      ...info,
      returns: [
        ...info.returns,
        { uid: crypto.randomUUID(), name: `output${info.returns.length + 1}`, dataType: "string" },
      ],
    }));
  }, [updateFunctionInfo]);

  const updateArgument = useCallback(
    (index: number, updates: Partial<NodeOutput>) => {
      updateFunctionInfo((info) => {
        const newArgs = [...info.arguments];
        newArgs[index] = { ...newArgs[index], ...updates };
        return { ...info, arguments: newArgs };
      });
    },
    [updateFunctionInfo],
  );

  const updateReturnValue = useCallback(
    (index: number, updates: Partial<NodeOutput>) => {
      updateFunctionInfo((info) => {
        const newReturnValues = [...info.returns];
        newReturnValues[index] = { ...newReturnValues[index], ...updates };
        return { ...info, returns: newReturnValues };
      });
    },
    [updateFunctionInfo],
  );

  const removeArgument = useCallback(
    (index: number) => {
      updateFunctionInfo((info) => ({
        ...info,
        arguments: info.arguments.filter((_, i) => i !== index),
      }));
    },
    [updateFunctionInfo],
  );

  const removeReturnValue = useCallback(
    (index: number) => {
      const removedUid = functionInfo?.returns[index]?.uid;
      updateFunctionInfo((info) => ({
        ...info,
        returns: info.returns.filter((_, i) => i !== index),
      }));
      if (removedUid) {
        updateOutputAssignments((assignments) => {
          const { [removedUid]: _, ...rest } = assignments;
          return rest;
        });
      }
    },
    [updateFunctionInfo, updateOutputAssignments, functionInfo],
  );

  // Output assignment handlers
  const getOutputAssignment = useCallback(
    (returnVar: Variable): Expression => {
      return outputAssignments[returnVar.uid] ?? { expression: "", references: [], dataType: returnVar.dataType };
    },
    [outputAssignments],
  );

  const setOutputAssignment = useCallback(
    (uid: string, expression: Expression) => {
      updateOutputAssignments((assignments) => ({
        ...assignments,
        [uid]: expression,
      }));
    },
    [updateOutputAssignments],
  );

  if (!functionInfo) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">{t("noFunctionInfo")}</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="space-y-4">
        {readOnly && (
          <div className="text-xs font-medium text-muted-foreground bg-muted/50 rounded px-2 py-1">
            {t("preview.viewOnly")}
          </div>
        )}

        {/* Function Name */}
        <div className="space-y-2">
          <Label htmlFor="function-name">{t("functionName")}</Label>
          <Input
            id="function-name"
            value={functionInfo.name}
            onChange={handleNameChange}
            readOnly={readOnly}
            placeholder={t("functionNamePlaceholder")}
            className="font-mono"
          />
        </div>

        <Separator />

        {/* Inputs Section */}
        <div className={readOnly ? "pointer-events-none opacity-60" : ""}>
        <PortSection
          ports={functionInfo.arguments}
          direction="input"
          onAdd={addArgument}
          onUpdate={updateArgument}
          onRemove={removeArgument}
          maxHeight="10rem"
        />

        <Separator />

        {/* Outputs Section */}
        <PortSection
          ports={functionInfo.returns}
          direction="output"
          onAdd={addReturnValue}
          onUpdate={updateReturnValue}
          onRemove={removeReturnValue}
          maxHeight="10rem"
        />

        {/* Return Value Assignments */}
        {functionInfo.returns.length > 0 && (
          <>
            <Separator />

            <div className="space-y-3">
              <Label className="text-sm font-medium">
                {t("returnValueAssignments")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("returnValueAssignmentsDesc")}
              </p>

              <div className="space-y-3">
                {functionInfo.returns.map((output) => (
                  <div key={output.uid} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{output.name}</Label>
                    <ExpressionInput
                      value={getOutputAssignment(output)}
                      onChange={(expr) => setOutputAssignment(output.uid, expr)}
                      expressionType={output.dataType}
                      availableVariables={availableVariables}
                      placeholder={`${t("expressionFor")} ${output.name}...`}
                    />
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
        </div>

        {/* Delete Function — hidden in readOnly */}
        {!readOnly && (
          <>
            <Separator />
            <Button variant="destructive" className="w-full" onClick={() => setShowDeleteConfirm(true)}>
              <Trash2 className="w-4 h-4 mr-2" />
              {t("deleteFunction")}
            </Button>
          </>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteFunctionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteFunctionDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onDeleteFunction();
                setShowDeleteConfirm(false);
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
