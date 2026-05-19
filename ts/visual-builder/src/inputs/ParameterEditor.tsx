import type { Schemas } from "@foresthub/workflow-core";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { Alert, AlertDescription } from "../components/ui/alert";
import { Button } from "../components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { DataType, Expression, Reference } from "@foresthub/workflow-core/types/node";
import type { ExpressionParam, ChannelSelectParam, LLMModelParam, Parameter, StringParam } from "@foresthub/workflow-core/types/parameter";
import { resolveCapabilities, resolveExpressionType, resolveChannelTypes } from "@foresthub/workflow-core/types/parameter";
import { useTranslation } from "react-i18next";
import { useAvailableVariables } from "../hooks/useAvailableVariables";
import { useDynamicSelectionOptions, type DynamicSelectionType } from "../hooks/useDynamicSelectionOptions";
import { useEditorStore } from "../store/editorStore";
import { canvasVarKey, refToLookupKey } from "../utils/variables";
import type { ChannelInstance } from "@foresthub/workflow-core/types/channel";
import ExpressionInput from "./ExpressionInput";
import { getParamDescription } from "../utils/translation";

type MemoryRef = Schemas["MemoryRef"];

/** Shared Select component for all reference-select parameter types */
function ReferenceSelect({
  value,
  options,
  isStale,
  loading,
  placeholder,
  onChange,
}: {
  value: string | undefined;
  options: { value: string; label: string }[];
  isStale: boolean;
  loading?: boolean;
  placeholder: string;
  onChange: (value: string | undefined) => void;
}) {
  const NONE = "__none__";
  const selectValue = isStale ? undefined : (value ?? NONE);

  return (
    <Select value={selectValue} onValueChange={(v) => onChange(v === NONE ? undefined : v)} disabled={loading}>
      <SelectTrigger>
        <SelectValue
          placeholder={
            isStale ? <span className="text-destructive">Deleted reference</span> : loading ? "Loading..." : placeholder
          }
        />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>
          <span className="text-muted-foreground italic pr-0.5">None</span>
        </SelectItem>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function getExpressionPlaceholder(dataType: DataType): string {
  switch (dataType) {
    case "int":
    case "float":
      return "${var1} + ${var2}";
    case "bool":
      return "${var1} > ${var2}";
    case "string":
      return "hello ${var1}";
    default:
      return "${var1}";
  }
}

interface ParameterEditorProps {
  canvasId: string;
  parameter: Parameter;
  value: unknown;
  allArguments: Record<string, unknown>;
  onChange: (value: unknown) => void;
  errors?: string[];
  translationPrefix?: string;
}

const ParameterEditor = ({
  canvasId,
  parameter,
  value,
  allArguments,
  onChange,
  errors,
  translationPrefix,
}: ParameterEditorProps) => {
  const { t } = useTranslation();
  // Do NOT fall back to parameter.default here — each input type handles undefined individually.
  // This preserves the distinction between "user cleared field" and "default value".
  const currentValue = value;
  const { list: variableList, lookup: variables } = useAvailableVariables(canvasId);
  const dynamicType: DynamicSelectionType =
    parameter.type === "rag-collection" ? "ragCollections" : parameter.type === "llm-model" ? "llmModels" : null;
  const llmCapabilities =
    parameter.type === "llm-model" ? resolveCapabilities(parameter as LLMModelParam, allArguments) : undefined;
  const { options: dynamicOptions, loading: dynamicLoading } = useDynamicSelectionOptions(dynamicType, llmCapabilities);
  const channels = useEditorStore((s) => s.channels);
  const memoryFiles = useEditorStore((s) => s.memoryFiles);

  const renderInput = () => {
    switch (parameter.type) {
      case "variable-reference": {
        const ref = currentValue as Reference | undefined;
        const selectedKey = ref?.varId ? refToLookupKey(ref) : undefined;
        const isStale = !!(selectedKey && !variables[selectedKey]);
        const options = variableList.map((v) => ({ value: canvasVarKey(v), label: `${v.name} (${v.dataType})` }));

        return (
          <ReferenceSelect
            value={selectedKey}
            options={options}
            isStale={isStale}
            placeholder="Select variable..."
            onChange={(key) => {
              if (!key) {
                onChange(undefined);
                return;
              }
              const variable = variables[key];
              if (!variable) return;
              const newRef: Reference =
                variable.kind === "node"
                  ? { srcId: variable.nodeId, varId: variable.outputId }
                  : variable.kind === "declared"
                    ? { srcId: "declared", varId: variable.uid }
                    : { srcId: "fnarg", varId: variable.uid };
              onChange(newRef);
            }}
          />
        );
      }

      case "expression": {
        const exprParam = parameter as ExpressionParam;
        // Resolve expressionType — static, args-only lambda, or derived from a referenced variable
        const resolvedType: DataType = resolveExpressionType(exprParam, allArguments, variables);
        // Ensure we have a valid expression object (create empty one if undefined)
        const exprValue: Expression =
          currentValue && typeof currentValue === "object" && "expression" in currentValue
            ? (currentValue as Expression)
            : { expression: "", references: [], dataType: resolvedType };
        return (
          <ExpressionInput
            value={exprValue}
            onChange={onChange}
            expressionType={resolvedType}
            availableVariables={variables}
            placeholder={getExpressionPlaceholder(resolvedType)}
          />
        );
      }

      case "string":
        if ((parameter as StringParam).multiline) {
          return (
            <Textarea
              value={(currentValue as string) || ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder={String(parameter.default ?? "")}
              rows={4}
            />
          );
        }
        return (
          <Input
            value={(currentValue as string) || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={String(parameter.default ?? "")}
          />
        );

      case "int":
        return (
          <Input
            type="number"
            step={1}
            value={currentValue != null ? (currentValue as number) : ""}
            onChange={(e) => {
              const numValue = parseInt(e.target.value, 10);
              onChange(isNaN(numValue) ? undefined : numValue);
            }}
            placeholder={parameter.default?.toString() || "0"}
          />
        );

      case "float":
        return (
          <Input
            type="number"
            step="any"
            className="[&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
            value={currentValue != null ? (currentValue as number) : ""}
            onChange={(e) => {
              const numValue = parseFloat(e.target.value);
              onChange(isNaN(numValue) ? undefined : numValue);
            }}
            placeholder={parameter.default?.toString() || "0"}
          />
        );

      case "bool": {
        const boolValue = currentValue as boolean;
        return (
          <div className="flex items-center space-x-2">
            <Switch checked={boolValue} onCheckedChange={onChange} />
            <span className="text-sm text-muted-foreground">{boolValue ? "Enabled" : "Disabled"}</span>
          </div>
        );
      }

      case "selection": {
        const NONE = "__none__";
        const selectValue = (currentValue as string) ?? (parameter.optional ? NONE : "");
        return (
          <Select value={selectValue} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {parameter.optional && (
                <SelectItem value={NONE}>
                  <span className="text-muted-foreground italic pr-0.5">None</span>
                </SelectItem>
              )}
              {parameter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case "rag-collection": {
        const selectedId = currentValue as string | undefined;
        const isStale = !!(selectedId && !dynamicLoading && !dynamicOptions.some((o) => o.value === selectedId));

        return (
          <ReferenceSelect
            value={selectedId}
            options={dynamicOptions}
            isStale={isStale}
            loading={dynamicLoading}
            placeholder="Select collection..."
            onChange={(v) => onChange(v)}
          />
        );
      }

      case "llm-model": {
        const selectedId = currentValue as string | undefined;
        const isStale = !!(selectedId && !dynamicLoading && !dynamicOptions.some((o) => o.value === selectedId));

        if (!dynamicLoading && dynamicOptions.length === 0) {
          return (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{t("builder.noModelsAvailable")}</AlertDescription>
            </Alert>
          );
        }

        return (
          <ReferenceSelect
            value={selectedId}
            options={dynamicOptions}
            isStale={isStale}
            loading={dynamicLoading}
            placeholder="Select model..."
            onChange={(v) => onChange(v)}
          />
        );
      }

      case "time":
        return <Input type="time" value={(currentValue as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;

      case "weekdays": {
        const DAYS = [
          { code: "mon", label: "Mon" },
          { code: "tue", label: "Tue" },
          { code: "wed", label: "Wed" },
          { code: "thu", label: "Thu" },
          { code: "fri", label: "Fri" },
          { code: "sat", label: "Sat" },
          { code: "sun", label: "Sun" },
        ];
        const selected = (currentValue as string[]) || [];
        const toggle = (code: string) => {
          const next = selected.includes(code) ? selected.filter((d) => d !== code) : [...selected, code];
          onChange(next);
        };
        return (
          <div className="space-y-1.5">
            <div className="flex gap-1">
              {DAYS.map((day) => (
                <button
                  key={day.code}
                  type="button"
                  onClick={() => toggle(day.code)}
                  className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                    selected.includes(day.code)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-field text-muted-foreground border-input hover:bg-muted/50"
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        );
      }

      case "memory-refs": {
        const refs = (currentValue as MemoryRef[] | undefined) ?? [];
        // Look up by uid (the store keys on uid via memoryFileKey() but Object.values
        // gives us instances we can match directly).
        const allFiles = Object.values(memoryFiles);
        const allFilesByUid = new Map(allFiles.map((m) => [m.uid, m]));

        const replace = (index: number, next: MemoryRef) =>
          onChange(refs.map((r, i) => (i === index ? next : r)));
        const remove = (index: number) => onChange(refs.filter((_, i) => i !== index));
        const add = () => {
          // Pre-select the first unused memory file (if any) so adding a row
          // immediately gives the user a valid binding to start tweaking.
          const usedUids = new Set(refs.map((r) => r.uid));
          const firstUnused = allFiles.find((m) => !usedUids.has(m.uid));
          onChange([...refs, { uid: firstUnused?.uid ?? "", mode: "r" as const }]);
        };

        // Always render existing refs (even when there are 0 memory files left)
        // so the user can delete dangling references after the underlying memory
        // file is removed. Mirror of the output-binding pattern in NodeConfigPanel.
        const canAdd = allFiles.length > refs.length;

        return (
          <div className="space-y-2">
            {refs.length === 0 && allFiles.length === 0 && (
              <p className="text-xs text-muted-foreground italic px-2 py-1">
                {t(
                  "builder.noMemoryFilesForAgent",
                  "No memory files declared yet. Add one from the Memory tab in the sidebar.",
                )}
              </p>
            )}
            {refs.map((ref, index) => {
              const file = ref.uid ? allFilesByUid.get(ref.uid) : undefined;
              const isStale = !!(ref.uid && !file);
              const usedByOthers = new Set(refs.filter((_, i) => i !== index).map((r) => r.uid));
              const selectableFiles = allFiles.filter((m) => m.uid === ref.uid || !usedByOthers.has(m.uid));

              return (
                <div
                  key={index}
                  className="rounded-lg bg-card shadow-sm p-2 space-y-2 transition-all hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <Select
                      value={ref.uid || undefined}
                      onValueChange={(uid) => replace(index, { ...ref, uid })}
                    >
                      <SelectTrigger className="h-7 text-xs flex-1">
                        <SelectValue
                          placeholder={
                            isStale ? (
                              <span className="text-destructive">
                                {t("builder.memoryRefStale", "Deleted memory file")}
                              </span>
                            ) : (
                              t("builder.selectMemoryFile", "Select memory file...")
                            )
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {selectableFiles.map((m) => (
                          <SelectItem key={m.uid} value={m.uid}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={() => remove(index)}
                      aria-label={t("builder.removeMemoryRef", "Remove memory ref")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  <ToggleGroup
                    type="single"
                    value={ref.mode}
                    onValueChange={(v) => v && replace(index, { ...ref, mode: v as "r" | "rw" })}
                    className="gap-0 justify-start"
                  >
                    <ToggleGroupItem
                      value="r"
                      size="sm"
                      variant="outline"
                      className="h-7 px-3 text-xs rounded-r-none"
                    >
                      {t("builder.memoryModeRead", "Read")}
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="rw"
                      size="sm"
                      variant="outline"
                      className="h-7 px-3 text-xs rounded-l-none -ml-px"
                    >
                      {t("builder.memoryModeReadWrite", "Read + Write")}
                    </ToggleGroupItem>
                  </ToggleGroup>
                </div>
              );
            })}
            {canAdd && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs w-full justify-start text-muted-foreground hover:text-foreground"
                onClick={add}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                {t("builder.addMemoryRef", "Add memory ref")}
              </Button>
            )}
          </div>
        );
      }

      case "channelSelect": {
        const channelParam = parameter as ParameterEditorProps["parameter"] & ChannelSelectParam;
        const allowedTypes = resolveChannelTypes(channelParam, allArguments);
        const matching = Object.values(channels).filter((v: ChannelInstance) => allowedTypes.includes(v.type));

        const selectedId = currentValue as string | undefined;
        const isStale = !!(selectedId && !matching.some((v) => v.id === selectedId));
        const options = matching.map((v) => ({ value: v.id, label: v.label }));

        return (
          <ReferenceSelect
            value={selectedId}
            options={options}
            isStale={isStale}
            placeholder={t("builder.selectChannel")}
            onChange={(v) => onChange(v)}
          />
        );
      }

      // Exhaustiveness check - fails if a parameter type is not handled
      default: {
        const _exhaustive: never = parameter;
        return _exhaustive;
      }
    }
  };

  const hasError = errors && errors.length > 0;

  return (
    <div className={`space-y-2 ${hasError ? "ring-1 ring-destructive rounded-md p-2" : ""}`}>
      <Label className="text-sm font-medium">
        {parameter.label}
        {parameter.optional !== true && <span className="text-destructive ml-1">*</span>}
      </Label>
      {parameter.description && (
        <p className="text-xs text-muted-foreground">
          {translationPrefix ? getParamDescription(t, translationPrefix, parameter) : parameter.description}
        </p>
      )}
      {renderInput()}
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

export default ParameterEditor;
