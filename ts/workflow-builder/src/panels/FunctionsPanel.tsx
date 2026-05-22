import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { FunctionSquare, Plus, Trash2, ArrowRight, LogIn, LogOut, Pencil } from "lucide-react";
import { cn } from "../lib/utils";
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
import type { FunctionInfo } from "@foresthub/workflow-core";
import { FunctionInfoDialog } from "../dialogs/FunctionInfoDialog";

interface FunctionsPanelProps {
  functions: FunctionInfo[];
  onOpenFunction: (functionId: string) => void;
  onAddFunction: (name: string, args?: FunctionInfo["arguments"], returns?: FunctionInfo["returns"]) => void;
  onEditFunction: (functionId: string, name: string, fn: FunctionInfo) => void;
  onDeleteFunction: (functionId: string) => void;
}

export const FunctionsPanel = ({
  functions,
  onOpenFunction,
  onAddFunction,
  onEditFunction,
  onDeleteFunction,
}: FunctionsPanelProps) => {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingFunction, setEditingFunction] = useState<FunctionInfo | undefined>(undefined);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleOpenCreateDialog = () => {
    setEditingFunction(undefined);
    setDialogOpen(true);
  };

  const handleOpenEditDialog = (fn: FunctionInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFunction(fn);
    setDialogOpen(true);
  };

  const handleDialogSave = (name: string, fn: FunctionInfo) => {
    if (editingFunction) {
      // Edit mode
      onEditFunction(editingFunction.id, name, fn);
    } else {
      // Create mode
      onAddFunction(name, fn.arguments, fn.returns);
    }
  };

  const confirmDelete = (functionId: string) => {
    onDeleteFunction(functionId);
    setDeleteConfirm(null);
  };

  return (
    <div className="space-y-3">
      {/* Add Function Button */}
      <div className="space-y-2">
        <Button variant="outline" size="sm" className="w-full justify-start gap-2 h-9" onClick={handleOpenCreateDialog}>
          <Plus className="w-4 h-4" />
          {t("addFunction")}
        </Button>
      </div>

      {/* Functions List */}
      {functions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <FunctionSquare className="w-10 h-10 text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">{t("noFunctions")}</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            {t("addFunctionHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {functions.map((fn) => {
            return (
              <div
                key={fn.id}
                onClick={() => onOpenFunction(fn.id)}
                className="group p-3 rounded-lg border transition-all cursor-pointer bg-node-function/5 border-node-function/20 hover:bg-node-function/10 hover:border-node-function/30"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <FunctionSquare className="w-4 h-4 shrink-0 text-node-function/70" />
                    <span className="font-mono text-sm truncate text-foreground/90">
                      {fn.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Port counts */}
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <LogIn className="w-3 h-3" />
                      <span>{fn.arguments.length}</span>
                      <ArrowRight className="w-2.5 h-2.5 mx-0.5" />
                      <LogOut className="w-3 h-3" />
                      <span>{fn.returns.length}</span>
                    </div>
                    {/* Edit button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity", "hover:bg-accent")}
                      onClick={(e) => handleOpenEditDialog(fn, e)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    {/* Delete button */}
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn(
                        "w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity",
                        "hover:bg-destructive/10 hover:text-destructive",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(fn.id);
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirm !== null} onOpenChange={() => setDeleteConfirm(null)}>
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
              onClick={() => deleteConfirm && confirmDelete(deleteConfirm)}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Function Definition Dialog */}
      <FunctionInfoDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleDialogSave}
        existingFunction={editingFunction}
      />
    </div>
  );
};
