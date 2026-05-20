import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import {
  NodeDefinition,
  NodeInstance,
  OutputBinding,
  DataType,
  Reference,
  FunctionCallNode,
  getArguments,
  getNodeAvailableOutput,
  getOutputBinding,
} from "@foresthub/workflow-core/node";
import type { StaticOutput, OutputList, OutputDeclaration } from "@foresthub/workflow-core/parameter";
import { isParameterActive, Parameter } from "@foresthub/workflow-core/parameter";
import { ArrowRight, ChevronRight, Plus, RefreshCw, Trash2 } from "lucide-react";
import { getOrCreateCanvasStore } from "../store/canvasStore";
import { isNodeUsedAsTool } from "@foresthub/workflow-core/node";
import { canvasVarKey, refToLookupKey } from "@foresthub/workflow-core/variable";
import type { Diagnostic } from "@foresthub/workflow-core/diagnostics";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ParameterEditor from "../inputs/ParameterEditor";
import { PortSection } from "../dialogs/FunctionInfoDialog";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { useFunctionRegistry } from "../hooks/useFunctionRegistry";
import { buildFunctionNodeDef } from "../hooks/useNodeDefinitions";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { migrateFunctionCallNodes } from "../utils/migrateFunctionNodes";
import { getNodeDescription } from "../utils/translation";
import { useAvailableVariables } from "../hooks/useAvailableVariables";

interface NodeConfigPanelProps {
  canvasId: string;
  selectedNode: NodeInstance;
  onNodeUpdate: (nodeId: string, updates: { arguments?: Record<string, unknown>; label?: string }) => void;
  onNodeDelete: (nodeId: string) => void;
  onClose: () => void;
  onOpenTest: (nodeId: string) => void;
  getNodeDef: (node: NodeInstance) => NodeDefinition | undefined;
}

export const NodeConfigPanel = ({
  canvasId,
  selectedNode,
  onNodeUpdate,
  onNodeDelete,
  onClose,
  onOpenTest,
  getNodeDef,
}: NodeConfigPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));

  // Local state for label input to preserve cursor position
  const [localLabel, setLocalLabel] = useState(selectedNode.label || "");
  const [isFocused, setIsFocused] = useState(false);
  useEffect(() => {
    setLocalLabel(selectedNode.label || "");
  }, [selectedNode.id]);

  // Check if FunctionCall node is stale (e.g. after undo reverted migration)
  const functionId = selectedNode.type === "FunctionCall" ? (selectedNode as FunctionCallNode).functionInfo.id : null;
  const { getFunction } = useFunctionRegistry();
  const functionInfo = functionId ? getFunction(functionId) : undefined;
  const isStaleFunction = (() => {
    if (selectedNode.type !== "FunctionCall" || !functionInfo) return false;
    const functionNode = selectedNode as FunctionCallNode;
    return functionNode.functionInfo.version !== functionInfo.version;
  })();

  // Get node definition - for FunctionCallNodes, build from node's stored functionInfo
  const nodeDefinition =
    selectedNode.type === "FunctionCall"
      ? buildFunctionNodeDef({
          ...(selectedNode as FunctionCallNode).functionInfo,
          name: functionInfo?.name ?? (selectedNode as FunctionCallNode).functionInfo.name,
        })
      : getNodeDef(selectedNode);
  const cannotDelete = nodeDefinition?.isUnremovable ?? false;

  // Detect whether this node is currently used as a tool input
  const edges = getOrCreateCanvasStore(canvasId)((s) => s.edges);
  const usedAsToolInput = useMemo(() => isNodeUsedAsTool(selectedNode.id, selectedNode, edges), [selectedNode, edges]);

  // Read per-parameter error state from diagnostics store
  const nodeDiags = useDiagnosticsStore((s) => s.byNodeId[selectedNode.id]);
  const paramErrors = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!nodeDiags) return map;
    for (const d of nodeDiags) {
      if (d.paramId && d.severity === "error") {
        const arr = map.get(d.paramId);
        if (arr) arr.push(d.message);
        else map.set(d.paramId, [d.message]);
      }
    }
    return map;
  }, [nodeDiags]);

  if (!nodeDefinition) {
    return (
      <div className="p-4">
        <p className="text-sm text-muted-foreground">{t("builder.unknownNodeType", { type: selectedNode.type })}</p>
      </div>
    );
  }
  const allArguments = getArguments(selectedNode);
  const parameters = nodeDefinition.parameters.filter((p) => isParameterActive(p, allArguments, usedAsToolInput));
  // OutputsSection self-hides when there's nothing to render; gate on "has any output defined".
  const hasAnyOutputs = (nodeDefinition.outputs ?? []).length > 0;

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 -mx-1.5 hover:border-input focus-within:border-input transition-colors">
              <input
                type="text"
                title={t("builder.nodeLabel")}
                className="font-semibold text-lg bg-transparent w-full outline-none cursor-text py-0.5"
                value={isFocused ? localLabel : localLabel || nodeDefinition.label}
                readOnly={readOnly}
                onFocus={() => {
                  if (readOnly) return;
                  setIsFocused(true);
                  if (!localLabel) {
                    setLocalLabel(nodeDefinition.label);
                  }
                }}
                onBlur={() => {
                  setIsFocused(false);
                  if (!localLabel || localLabel === nodeDefinition.label) {
                    setLocalLabel("");
                    onNodeUpdate(selectedNode.id, { label: undefined });
                  }
                }}
                onChange={(e) => {
                  setLocalLabel(e.target.value);
                  onNodeUpdate(selectedNode.id, { label: e.target.value });
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{getNodeDescription(t, nodeDefinition)}</p>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {readOnly && (
          <div className="text-xs font-medium text-muted-foreground bg-muted/50 rounded px-2 py-1">
            {t("builder.preview.viewOnly")}
          </div>
        )}

        {parameters.length > 0 && (
          <>
            <Separator />
            <div className={`space-y-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
              {parameters.map((param: Parameter) => (
                <ParameterEditor
                  canvasId={canvasId}
                  key={param.id}
                  parameter={param}
                  value={allArguments[param.id]}
                  allArguments={allArguments}
                  onChange={(value) => onNodeUpdate(selectedNode.id, { arguments: { [param.id]: value } })}
                  errors={paramErrors.get(param.id)}
                  translationPrefix={`nodes.${selectedNode.type}`}
                />
              ))}
            </div>
          </>
        )}

        {!readOnly && isStaleFunction && (
          <>
            <Separator />
            <Button
              variant="outline"
              className="w-full border-warning text-warning hover:bg-warning/10"
              onClick={() => migrateFunctionCallNodes()}
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              {t("builder.updateToLatestDefinition")}
            </Button>
          </>
        )}

        {!readOnly && hasAnyOutputs && !usedAsToolInput && (
          <>
            <Separator />
            <OutputsSection
              canvasId={canvasId}
              node={selectedNode}
              nodeDefinition={nodeDefinition}
              onNodeUpdate={onNodeUpdate}
              nodeDiags={nodeDiags}
            />
          </>
        )}

        {!readOnly && selectedNode.type === "Agent" && (
          <>
            <Separator />
            <Button variant="outline" className="w-full" onClick={() => onOpenTest(selectedNode.id)}>
              {t("builder.testAgent")}
            </Button>
          </>
        )}

        {!readOnly && !cannotDelete && (
          <>
            <Separator />
            <Button variant="destructive" className="w-full" onClick={() => onNodeDelete(selectedNode.id)}>
              <Trash2 className="w-4 h-4 mr-2" />
              {t("builder.deleteNode")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// Outputs Section
// ============================================================================
//
// Single unified section for all of a node's outputs. Renders under one "OUTPUTS"
// header with sequential rows — no sub-sections, no per-list separator. Two row
// shapes live side by side here:
//
//  1. Static output row     — rows for NodeDefinition.outputs.type === "static"
//                             (FunctionCall returns are just StaticOutputs — they
//                             flow through this same path). Active checkbox toggles
//                             binding.active; mode toggle picks emit vs. assign.
//  2. List declaration row  — rows for each entry in an OutputList's backing array
//                             (mode: emit/assign, own dataType selector, own delete button)
//
// List outputs also render an "+ Add" button after their entries so new declarations
// can be appended. Errors on any row (static or list) apply a destructive ring using
// the same `outputId` key diagnostics.ts produces.

const DATA_TYPES: DataType[] = ["int", "float", "bool", "string"];

const DATA_TYPE_LABELS: Record<DataType, string> = {
  int: "int",
  float: "float",
  bool: "bool",
  string: "string",
};

/** Stable synthetic outputId used to key list-entry diagnostics (matches diagnostics.ts). */
function listEntryOutputId(listId: string, index: number): string {
  return `${listId}[${index}]`;
}

/** Convert an AvailableVariable into a canonical Reference (srcId + varId). */
function availableVarToRef(v: { kind: "node"; nodeId: string; outputId: string } | { kind: "declared"; uid: string } | { kind: "fnarg"; uid: string }): Reference {
  if (v.kind === "node") return { srcId: v.nodeId, varId: v.outputId };
  if (v.kind === "declared") return { srcId: "declared", varId: v.uid };
  return { srcId: "fnarg", varId: v.uid };
}

function OutputsSection({
  canvasId,
  node,
  nodeDefinition,
  onNodeUpdate,
  nodeDiags,
}: {
  canvasId: string;
  node: NodeInstance;
  nodeDefinition: NodeDefinition;
  onNodeUpdate: (nodeId: string, updates: { arguments?: Record<string, unknown> }) => void;
  nodeDiags: Diagnostic[] | undefined;
}) {
  const { t } = useTranslation();
  const { list: availableVars } = useAvailableVariables(canvasId);
  const availableOutput = useMemo(() => getNodeAvailableOutput(node), [node]);

  const staticOutputs = useMemo(
    () => (nodeDefinition.outputs ?? []).filter((o): o is StaticOutput => o.type === "static"),
    [nodeDefinition],
  );
  const listOutputs = useMemo(
    () => (nodeDefinition.outputs ?? []).filter((o): o is OutputList => o.type === "list"),
    [nodeDefinition],
  );

  // Collect diagnostics keyed by outputId so rows can look themselves up.
  const outputErrors = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!nodeDiags) return map;
    for (const d of nodeDiags) {
      if (d.outputId && d.severity === "error") {
        const arr = map.get(d.outputId);
        if (arr) arr.push(d.message);
        else map.set(d.outputId, [d.message]);
      }
    }
    return map;
  }, [nodeDiags]);

  /**
   * Write a binding for a static output (or FunctionCall return). List entries
   * have their own update path via `replaceListEntry`.
   */
  const updateStaticBinding = useCallback(
    (key: string, binding: OutputBinding) => {
      onNodeUpdate(node.id, { arguments: { [key]: binding } });
    },
    [node.id, onNodeUpdate],
  );

  const writeListEntries = useCallback(
    (listId: string, next: OutputDeclaration[]) => onNodeUpdate(node.id, { arguments: { [listId]: next } }),
    [node.id, onNodeUpdate],
  );

  // Filter available vars to matching dataType, excluding this node's own outputs
  // (a node can't assign its own output back into itself).
  const filterCompatible = useCallback(
    (dataType: DataType) =>
      availableVars.filter((v) => v.dataType === dataType && !("nodeId" in v && v.nodeId === node.id)),
    [availableVars, node.id],
  );

  // Any rows to show? Early-exit so the parent panel doesn't render an empty section.
  if (staticOutputs.length === 0 && listOutputs.length === 0) return null;

  // --- Row renderer: static output / FunctionCall return ------------------------------
  // UX shape:
  //   ┌─ card ────────────────────────────────────────┐
  //   │ [☑] label                              dataType │
  //   │     [emit | assign]  [ name OR variable picker ] │
  //   └────────────────────────────────────────────────┘
  // Checkbox sits inline with the label (so the card width matches list-entry rows
  // which have no checkbox). Toggles `binding.active`; mode/name/target are kept as
  // draft state when inactive so off→on round-trips identically. Body is dimmed and
  // pointer-event-disabled while inactive.
  const renderStaticRow = (key: string, output: { name: string; dataType: DataType }, displayLabel: string) => {
    const binding =
      getOutputBinding(node, key) ?? ({ active: true, mode: "emit", name: output.name } as OutputBinding);
    const compatibleVars = filterCompatible(output.dataType);
    const errors = outputErrors.get(key);
    const hasError = !!errors?.length;
    const enabled = binding.active;

    const setEnabled = (next: boolean) => {
      if (next === enabled) return;
      updateStaticBinding(key, { ...binding, active: next });
    };
    const setMode = (mode: "emit" | "assign") => {
      if (mode === binding.mode) return;
      if (mode === "emit") updateStaticBinding(key, { active: binding.active, mode: "emit", name: output.name });
      else updateStaticBinding(key, { active: binding.active, mode: "assign", target: { srcId: "", varId: "" } });
    };

    return (
      <div
        key={key}
        className={`rounded-lg bg-card shadow-sm p-2 space-y-2 transition-all hover:shadow-md ${hasError ? "border border-destructive ring-1 ring-destructive" : ""}`}
      >
        <div className="flex items-center gap-2">
          <Checkbox
            checked={enabled}
            onCheckedChange={(c) => setEnabled(c === true)}
            aria-label={t("builder.outputBinding.enable", "Enable output")}
            className="shrink-0"
          />
          <span className={`text-xs font-medium flex-1 truncate ${enabled ? "" : "opacity-50"}`}>{displayLabel}</span>
          <span className={`text-xs text-muted-foreground ${enabled ? "" : "opacity-50"}`}>
            {DATA_TYPE_LABELS[output.dataType]}
          </span>
        </div>
        <div className={enabled ? "" : "opacity-50"}>
          <div className={`flex items-center gap-2 ${enabled ? "" : "pointer-events-none"}`}>
            <ToggleGroup
              type="single"
              value={binding.mode}
              onValueChange={(v) => v && setMode(v as "emit" | "assign")}
              className="gap-0"
            >
              <ToggleGroupItem
                value="emit"
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0 rounded-r-none"
                aria-label={t("builder.outputBinding.emit", "Emit")}
                title={t("builder.outputBinding.emit", "Emit")}
              >
                <Plus className="w-3.5 h-3.5" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="assign"
                size="sm"
                variant="outline"
                className="h-7 w-7 p-0 rounded-l-none -ml-px"
                aria-label={t("builder.outputBinding.assign", "Assign")}
                title={t("builder.outputBinding.assign", "Assign")}
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </ToggleGroupItem>
            </ToggleGroup>

            {binding.mode === "emit" ? (
              <Input
                className="h-7 text-xs flex-1"
                value={binding.name}
                disabled={!enabled}
                onChange={(e) => updateStaticBinding(key, { active: binding.active, mode: "emit", name: e.target.value })}
              />
            ) : compatibleVars.length > 0 ? (
              <Select
                value={binding.target.srcId ? refToLookupKey(binding.target) : ""}
                onValueChange={(lookupKey) => {
                  const v = availableVars.find((av) => canvasVarKey(av) === lookupKey);
                  if (!v) return;
                  updateStaticBinding(key, { active: binding.active, mode: "assign", target: availableVarToRef(v) });
                }}
                disabled={!enabled}
              >
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue placeholder={t("builder.outputBinding.selectVariable", "Select variable...")} />
                </SelectTrigger>
                <SelectContent>
                  {compatibleVars.map((v) => (
                    <SelectItem key={canvasVarKey(v)} value={canvasVarKey(v)}>
                      {v.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-xs text-muted-foreground italic flex-1">
                {t("builder.outputBinding.noCompatibleVariables", "No compatible variables")}
              </span>
            )}
          </div>
          {hasError && (
            <div className="space-y-0.5">
              {errors.map((msg, i) => (
                <p key={i} className="text-xs text-destructive">
                  {msg}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  // --- Row renderer: list declaration entry ------------------------------------------
  const renderListEntryRow = (
    listId: string,
    entries: OutputDeclaration[],
    index: number,
  ) => {
    const entry = entries[index];
    const compatibleVars = filterCompatible(entry.dataType);
    const outputId = listEntryOutputId(listId, index);
    const errors = outputErrors.get(outputId);
    const hasError = !!errors?.length;

    const replace = (next: OutputDeclaration) => writeListEntries(listId, entries.map((e, i) => (i === index ? next : e)));
    const remove = () => writeListEntries(listId, entries.filter((_, i) => i !== index));
    // Mode flip preserves name + dataType — the user already typed/picked them.
    // emit↔assign only swaps the trailing payload (uid vs target).
    const changeMode = (newMode: "emit" | "assign") => {
      if (entry.mode === newMode) return;
      if (newMode === "emit") {
        replace({ mode: "emit", uid: crypto.randomUUID(), name: entry.name, dataType: entry.dataType });
      } else {
        replace({ mode: "assign", name: entry.name, dataType: entry.dataType, target: { srcId: "", varId: "" } });
      }
    };
    const changeName = (name: string) => replace({ ...entry, name });
    const changeDataType = (dt: DataType) => replace({ ...entry, dataType: dt });

    return (
      <div
        key={`${listId}-${entry.mode === "emit" ? entry.uid : `assign-${index}`}`}
        className={`rounded-lg bg-card shadow-sm p-2 space-y-2 transition-all hover:shadow-md ${hasError ? "border border-destructive ring-1 ring-destructive" : ""}`}
      >
        <div className="flex items-center gap-2">
          {/* Row 1 mirrors OutputBinding's header: leading control (trash↔checkbox),
              name (editable here, label-only there), dataType (editable here, RO there). */}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={remove}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Input
            className="h-7 text-xs flex-1"
            value={entry.name}
            placeholder={t("builder.outputBinding.name", "Name")}
            onChange={(e) => changeName(e.target.value)}
          />
          <Select value={entry.dataType} onValueChange={(dt: DataType) => changeDataType(dt)}>
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
        </div>
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={entry.mode}
            onValueChange={(v) => v && changeMode(v as "emit" | "assign")}
            className="gap-0"
          >
            <ToggleGroupItem
              value="emit"
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 rounded-r-none"
              aria-label={t("builder.outputBinding.emit", "Emit")}
              title={t("builder.outputBinding.emit", "Emit")}
            >
              <Plus className="w-3.5 h-3.5" />
            </ToggleGroupItem>
            <ToggleGroupItem
              value="assign"
              size="sm"
              variant="outline"
              className="h-7 w-7 p-0 rounded-l-none -ml-px"
              aria-label={t("builder.outputBinding.assign", "Assign")}
              title={t("builder.outputBinding.assign", "Assign")}
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
          {entry.mode === "emit" ? (
            <span className="text-xs text-muted-foreground italic flex-1">
              {t("builder.outputBinding.emitHint", "creates new variable in scope")}
            </span>
          ) : compatibleVars.length > 0 ? (
            <Select
              value={entry.target.srcId ? refToLookupKey(entry.target) : ""}
              onValueChange={(lookupKey) => {
                const v = availableVars.find((av) => canvasVarKey(av) === lookupKey);
                if (!v) return;
                replace({ ...entry, target: availableVarToRef(v) });
              }}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue placeholder={t("builder.outputBinding.selectVariable", "Select variable...")} />
              </SelectTrigger>
              <SelectContent>
                {compatibleVars.map((v) => (
                  <SelectItem key={canvasVarKey(v)} value={canvasVarKey(v)}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-xs text-muted-foreground italic flex-1">
              {t("builder.outputBinding.noCompatibleVariables", "No compatible variables")}
            </span>
          )}
        </div>
        {hasError && (
          <div className="space-y-0.5">
            {errors.map((msg, i) => (
              <p key={i} className="text-xs text-destructive">
                {msg}
              </p>
            ))}
          </div>
        )}
      </div>
    );
  };

  const addListEntry = (listId: string, entries: OutputDeclaration[]) => {
    const fresh: OutputDeclaration = {
      mode: "emit",
      uid: crypto.randomUUID(),
      name: `output${entries.length + 1}`,
      dataType: "string",
    };
    writeListEntries(listId, [...entries, fresh]);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t("builder.outputs", "Outputs")}
      </p>
      <div className="space-y-2">
        {/* Static outputs from the node definition (FunctionCall returns flow here too). */}
        {staticOutputs.map((out) => {
          const output = availableOutput[out.id];
          if (!output) return null;
          return renderStaticRow(out.id, output, out.label);
        })}

        {/* List outputs — each list gets a minor subheader (its label), then its entries,
            then an "Add" button. The subheader also serves as the visual boundary between
            static outputs above and list entries below. */}
        {listOutputs.map((out) => {
            const entries =
              ((node.arguments as Record<string, unknown>)[out.id] as OutputDeclaration[] | undefined) ?? [];
            return (
              <Fragment key={out.id}>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[11px] font-medium text-muted-foreground">{out.label}</span>
                  <div className="flex-1 h-px bg-border/60" />
                </div>
                {entries.map((_, index) => renderListEntryRow(out.id, entries, index))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs w-full justify-start text-muted-foreground hover:text-foreground"
                  onClick={() => addListEntry(out.id, entries)}
                >
                  + {t("builder.addOutput", { label: out.label, defaultValue: `Add ${out.label.toLowerCase()}` })}
                </Button>
              </Fragment>
            );
          })}
      </div>
    </div>
  );
}
