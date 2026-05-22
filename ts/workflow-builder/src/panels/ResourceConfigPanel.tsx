import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { ChevronRight } from "lucide-react";
import type { Parameter } from "@foresthub/workflow-core/parameter";
import type { Diagnostic } from "@foresthub/workflow-core/diagnostics";
import ParameterEditor from "../inputs/ParameterEditor";
import { MAIN_CANVAS_ID } from "../stores/canvasStore";
import { useEditorStore, isReadOnly } from "../stores/editorStore";
import { useParamErrors } from "../hooks/useParamErrors";
import { ReadOnlyBanner } from "../components/ui/readonly-banner";
import { DeleteButton } from "../components/ui/delete-button";

interface ResourceConfigPanelProps {
  /** Stable id of the open resource — resets the local label field when it changes. */
  resetKey: string;
  label: string;
  /** `title`/aria text for the label input. */
  labelTitle: string;
  onLabelChange: (label: string) => void;
  description: string;
  /** Optional validation messages rendered under the title (e.g. empty/duplicate label). */
  belowLabel?: ReactNode;
  parameters: Parameter[];
  /** Read the current value for a parameter (channels map `type` to a top-level field). */
  getValue: (param: Parameter) => unknown;
  allArguments: Record<string, unknown>;
  onParamChange: (paramId: string, value: unknown) => void;
  diagnostics: Diagnostic[] | undefined;
  translationPrefix: string;
  deleteLabel: string;
  onDelete: () => void;
  onClose: () => void;
  /** Canvas used for variable resolution in ParameterEditor. Project-scoped resources use MAIN. */
  canvasId?: string;
}

/**
 * Shared editor shell for the project-scoped "primitive" resources that all
 * render a `{type, arguments}` bag through `ParameterEditor` — channels, memory,
 * declared models. Owns the chrome (editable title, readOnly banner, parameter
 * list, delete/close buttons); each wrapper supplies the parameter source, the
 * value accessor, and the mutation callbacks. Nodes/edges are too divergent to
 * use this and keep their own bodies (sharing only {@link useParamErrors}).
 */
export const ResourceConfigPanel = ({
  resetKey,
  label,
  labelTitle,
  onLabelChange,
  description,
  belowLabel,
  parameters,
  getValue,
  allArguments,
  onParamChange,
  diagnostics,
  translationPrefix,
  deleteLabel,
  onDelete,
  onClose,
  canvasId = MAIN_CANVAS_ID,
}: ResourceConfigPanelProps) => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const paramErrors = useParamErrors(diagnostics);

  // Local label state preserves cursor position on edit; resets when a different
  // resource is opened.
  const [localLabel, setLocalLabel] = useState(label);
  useEffect(() => {
    setLocalLabel(label);
  }, [resetKey]);

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 -mx-1.5 hover:border-input focus-within:border-input transition-colors">
              <input
                type="text"
                title={labelTitle}
                className="font-semibold text-lg bg-transparent w-full outline-none cursor-text py-0.5"
                value={localLabel}
                readOnly={readOnly}
                onChange={(e) => {
                  setLocalLabel(e.target.value);
                  onLabelChange(e.target.value);
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">{description}</p>
            {belowLabel}
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onClose}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {readOnly && <ReadOnlyBanner />}

        {parameters.length > 0 && (
          <>
            <Separator />
            <div className={`space-y-3 ${readOnly ? "pointer-events-none opacity-60" : ""}`}>
              {parameters.map((param) => (
                <ParameterEditor
                  key={param.id}
                  canvasId={canvasId}
                  parameter={param}
                  value={getValue(param)}
                  allArguments={allArguments}
                  onChange={(value) => onParamChange(param.id, value)}
                  errors={paramErrors.get(param.id)}
                  translationPrefix={translationPrefix}
                />
              ))}
            </div>
          </>
        )}

        {!readOnly && (
          <>
            <Separator />
            <DeleteButton onClick={onDelete}>{deleteLabel}</DeleteButton>
          </>
        )}
      </div>
    </div>
  );
};
