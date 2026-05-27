import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ArrowLeft, ArrowRight, Plus, Trash2 } from "lucide-react";
import type { NodeOutput } from "@foresthubai/workflow-core/node";
import type { ApiVariable } from "@foresthubai/workflow-core/variable";
import type { DataType } from "@foresthubai/workflow-core";

const DATA_TYPES: DataType[] = ["int", "float", "bool", "string"];

// Editor for a single function port (an argument or a return): name + dataType + remove.
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

// A section of ports (the inputs or the outputs of a function), with add/edit/remove.
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
