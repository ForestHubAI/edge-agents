import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import type { FunctionInfo, NodeOutput, ApiVariable } from "@foresthub/workflow-core/node";
import { useFunctionInfo } from "../hooks/useFunctionInfo";
import { DataType } from "@foresthub/workflow-core/node";

const DATA_TYPES: DataType[] = ["int", "float", "bool", "string"];

// Sub-component for editing a single variable
export interface VariableEditorProps {
  variable: NodeOutput | ApiVariable;
  onUpdate: (updates: Partial<NodeOutput>) => void;
  onRemove: () => void;
}

export const VariableEditor = ({ variable, onUpdate, onRemove }: VariableEditorProps) => {
  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/30 border border-border/50">
      <Input
        value={variable.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
        className="h-7 text-xs flex-1"
        placeholder="Name"
      />
      <Select value={variable.dataType} onValueChange={(value) => onUpdate({ dataType: value as DataType })}>
        <SelectTrigger className="h-7 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATA_TYPES.map((type) => (
            <SelectItem key={type} value={type} className="text-xs">
              {type}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="w-3 h-3" />
      </Button>
    </div>
  );
};

// Sub-component for a section of ports (inputs or outputs)
export interface PortSectionProps {
  ports: (NodeOutput | ApiVariable)[];
  direction: "input" | "output";
  onAdd: () => void;
  onUpdate: (index: number, updates: Partial<NodeOutput>) => void;
  onRemove: (index: number) => void;
  maxHeight?: string;
}

export const PortSection = ({ ports, direction, onAdd, onUpdate, onRemove, maxHeight }: PortSectionProps) => {
  const { t } = useTranslation();
  const isInput = direction === "input";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm font-medium">
          {isInput ? (
            <ArrowRight className="w-4 h-4 text-node-input" />
          ) : (
            <ArrowLeft className="w-4 h-4 text-node-output" />
          )}
          {isInput ? t("inputs") : t("outputs")}
        </Label>
        <Button variant="ghost" size="sm" onClick={onAdd} className="h-7 px-2 text-xs">
          <Plus className="w-3 h-3 mr-1" />
          {t("add")}
        </Button>
      </div>

      {ports.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">{isInput ? t("noInputs") : t("noOutputs")}</p>
      ) : (
        <div className="space-y-2 overflow-auto" style={maxHeight ? { maxHeight } : undefined}>
          {ports.map((port, index) => (
            <VariableEditor
              key={"uid" in port && port.uid ? port.uid : `${direction}_${index}`}
              variable={port}
              onUpdate={(updates) => onUpdate(index, updates)}
              onRemove={() => onRemove(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Dialog Component
// ============================================================================

interface FunctionInfoDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (name: string, fn: FunctionInfo) => void;
  existingFunction?: FunctionInfo; // If provided, edit mode; otherwise create mode
}

export const FunctionInfoDialog = ({ open, onClose, onSave, existingFunction }: FunctionInfoDialogProps) => {
  const { t } = useTranslation();
  const isEditMode = !!existingFunction;

  // Local state for the form
  const [name, setName] = useState("");
  const [functionData, setFunctionData] = useState<FunctionInfo>({
    id: "",
    name: "",
    version: 1,
    arguments: [],
    returns: [],
  });

  const { addArgument, addReturnValue, updateArgument, updateReturnValue, removeArgument, removeReturnValue } =
    useFunctionInfo(functionData, setFunctionData);

  // Reset form when dialog opens or existingFunction changes
  useEffect(() => {
    if (open) {
      if (existingFunction) {
        setName(existingFunction.name);
        setFunctionData({ ...existingFunction });
      } else {
        setName("");
        setFunctionData({
          id: "",
          name: "",
          version: 1,
          arguments: [],
          returns: [],
        });
      }
    }
  }, [open, existingFunction]);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave(name.trim(), functionData);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && e.ctrlKey) {
      handleSave();
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-md" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{isEditMode ? t("editFunction") : t("createFunction")}</DialogTitle>
          <DialogDescription>{t("functionDialogDesc")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Function Name */}
          <div className="space-y-2">
            <Label htmlFor="function-name">{t("functionName")}</Label>
            <Input
              id="function-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("functionNamePlaceholder")}
              autoFocus
            />
          </div>

          {/* Arguments Section */}
          <PortSection
            ports={functionData.arguments}
            direction="input"
            onAdd={addArgument}
            onUpdate={updateArgument}
            onRemove={removeArgument}
            maxHeight="8rem"
          />

          {/* Return Values Section */}
          <PortSection
            ports={functionData.returns}
            direction="output"
            onAdd={addReturnValue}
            onUpdate={updateReturnValue}
            onRemove={removeReturnValue}
            maxHeight="8rem"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            {isEditMode ? t("save") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
