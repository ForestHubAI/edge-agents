import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Variable as VariableIcon, Hash, ToggleLeft, Type, List, FileJson, Plus, Trash2 } from "lucide-react";
import { cn } from "../lib/utils";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { useAvailableVariables } from "../hooks/useAvailableVariables";
import { getOrCreateCanvasStore, MAIN_CANVAS_ID } from "../store/canvasStore";
import { declaredVarKey, type AvailableVariable, type DeclaredVariable } from "@foresthub/workflow-core/variable";
import type { DataType } from "@foresthub/workflow-core/node";
import { generateId } from "../utils/IDs";

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

const DATA_TYPES: DataType[] = ["int", "float", "bool", "string"];

export const VariablesPanel = ({ canvasId, onSelectNode }: VariablesPanelProps) => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const { t } = useTranslation();
  const { list: variables } = useAvailableVariables(canvasId);

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

  const addDeclaredVariable = () => {
    store.takeCheckpoint();
    const existingNames = declaredVariables.map((d) => d.var.name);
    let counter = 1;
    while (existingNames.includes(`var${counter}`)) counter++;
    const uid = generateId("gvar");
    const newVar: DeclaredVariable = {
      kind: "declared",
      uid,
      name: `var${counter}`,
      dataType: "int",
    };
    store.getState().setVariables((vars) => ({ ...vars, [declaredVarKey(uid)]: newVar }));
  };

  const updateDeclaredVariable = (uid: string, updates: Partial<Omit<DeclaredVariable, "kind">>) => {
    store.takeCheckpoint();
    const key = declaredVarKey(uid);
    store.getState().setVariables((vars) => {
      const existing = vars[key];
      if (!existing || existing.kind !== "declared") return vars;
      return { ...vars, [key]: { ...existing, ...updates } };
    });
  };

  const deleteDeclaredVariable = (uid: string) => {
    store.takeCheckpoint();
    const key = declaredVarKey(uid);
    store.getState().setVariables((vars) => {
      const { [key]: _, ...rest } = vars;
      return rest;
    });
  };

  const renderInitialValueInput = (uid: string, dv: DeclaredVariable) => {
    switch (dv.dataType) {
      case "bool":
        return (
          <Select
            value={dv.initialValue != null ? String(dv.initialValue) : "false"}
            onValueChange={(v) => updateDeclaredVariable(uid, { initialValue: v === "true" })}
          >
            <SelectTrigger className="h-7 text-xs w-20">
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
            className="h-7 text-xs w-24"
            value={(dv.initialValue as string) ?? ""}
            onChange={(e) => updateDeclaredVariable(uid, { initialValue: e.target.value })}
            placeholder='""'
          />
        );
      case "int":
      case "float":
        return (
          <Input
            type="number"
            step={dv.dataType === "float" ? "any" : 1}
            className="h-7 text-xs w-20"
            value={dv.initialValue != null ? Number(dv.initialValue) : ""}
            onChange={(e) => {
              const num = dv.dataType === "float" ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
              updateDeclaredVariable(uid, { initialValue: isNaN(num) ? undefined : num });
            }}
            placeholder="0"
          />
        );
      default:
        return null;
    }
  };

  // Filter variables into groups (each canvas is self-contained — no main-canvas leakage)
  const functionArgs = variables.filter((v) => v.kind === "fnarg");
  const nodeOutputs = variables.filter((v) => v.kind === "node");

  const [editingVarUid, setEditingVarUid] = React.useState<string | null>(null);
  const editRef = React.useRef<HTMLDivElement>(null);

  // Click-outside to close editing (ignore clicks on dropdown portals)
  React.useEffect(() => {
    if (!editingVarUid) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (editRef.current && !editRef.current.contains(target) && !(target instanceof Element && target.closest("[data-radix-popper-content-wrapper]"))) {
        setEditingVarUid(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [editingVarUid]);

  const closeOnKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setEditingVarUid(null); }
  };

  const hasContent = functionArgs.length > 0 || nodeOutputs.length > 0 || declaredVariables.length > 0;

  if (!hasContent) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <VariableIcon className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">{t("noVariables")}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">
          {t("addNodesForVariables")}
        </p>
        {!readOnly && (
          <Button variant="outline" size="sm" className="mt-3" onClick={addDeclaredVariable}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            {t("addVariable")}
          </Button>
        )}
      </div>
    );
  }

  const renderVariableItem = (ref: AvailableVariable, clickable: boolean) => {
    const TypeIcon = typeIcons[ref.dataType] || VariableIcon;
    const typeColor = typeColors[ref.dataType] || typeColors.any;

    return (
      <div
        key={
          ref.kind === "node"
            ? `${ref.nodeId}-${ref.outputId}`
            : ref.kind === "declared"
              ? `declared-${ref.uid}`
              : `fnarg-${ref.uid}`
        }
        onClick={clickable && ref.kind === "node" ? () => onSelectNode(ref.nodeId) : undefined}
        className={cn(
          "p-3 rounded-lg bg-card shadow-sm transition-all",
          clickable && ref.kind === "node" ? "hover:shadow-md cursor-pointer" : "cursor-default",
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

  const SectionHeader = ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <div className="flex items-center justify-between px-1 mb-2">
      <span className="text-sm font-medium text-foreground/80">{title}</span>
      {action}
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Function Arguments (function canvas only) */}
      {!isMainCanvas && functionArgs.length > 0 && (
        <div>
          <SectionHeader title={t("functionArguments")} />
          <div className="space-y-1.5">{functionArgs.map((v) => renderVariableItem(v, false))}</div>
        </div>
      )}

      {/* Node Output Variables */}
      {nodeOutputs.length > 0 && (
        <div>
          <SectionHeader title={t("nodeOutputVariables")} />
          <div className="space-y-1.5">{nodeOutputs.map((v) => renderVariableItem(v, true))}</div>
        </div>
      )}

      {/* Defined Variables */}
      <div>
        <SectionHeader title={t("definedVariables")} />
        <div className="space-y-1.5">
          {declaredVariables.map(({ uid, var: dv }) => {
            const isEditing = editingVarUid === uid;
            const TypeIcon = typeIcons[dv.dataType] || VariableIcon;
            const typeColor = typeColors[dv.dataType] || typeColors.any;

            if (isEditing) {
              return (
                <div ref={editRef} key={uid} className="p-2.5 rounded-lg border bg-primary/5 border-primary/20 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      className="h-7 text-xs font-mono flex-1 min-w-0"
                      value={dv.name}
                      onChange={(e) => updateDeclaredVariable(uid, { name: e.target.value })}
                      onKeyDown={closeOnKey}
                      autoFocus
                    />
                    <Select
                      value={dv.dataType}
                      onValueChange={(v) =>
                        updateDeclaredVariable(uid, { dataType: v as DataType, initialValue: undefined })
                      }
                    >
                      <SelectTrigger className="h-7 text-xs w-20">
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
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteDeclaredVariable(uid)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">
                      {t("initialValue")}
                    </span>
                    <div className="flex-1">{renderInitialValueInput(uid, dv)}</div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={uid}
                onClick={readOnly ? undefined : () => setEditingVarUid(uid)}
                className={cn(
                  "p-3 rounded-lg bg-card shadow-sm transition-all",
                  readOnly ? "cursor-default" : "hover:shadow-md cursor-pointer",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <TypeIcon className={cn("w-4 h-4", typeColor)} />
                    <span className="font-mono text-sm text-foreground">{dv.name}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{dv.dataType}</span>
                </div>
              </div>
            );
          })}
          {!readOnly && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs border-dashed"
              onClick={() => {
                addDeclaredVariable();
                const vars = store.getState().variables;
                const declaredKeys = Object.keys(vars).filter((k) => k.startsWith("declared:"));
                const lastKey = declaredKeys[declaredKeys.length - 1];
                if (lastKey) setEditingVarUid(lastKey.slice("declared:".length));
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {t("addVariable")}
            </Button>
          )}
        </div>
      </div>

    </div>
  );
};
