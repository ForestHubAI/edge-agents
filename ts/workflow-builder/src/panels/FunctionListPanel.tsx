import { useTranslation } from "react-i18next";
import { FunctionSquare, Plus } from "lucide-react";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useEditorStore } from "../stores/editorStore";
import { ResourceListPanel } from "./ResourceListPanel";

interface FunctionListPanelProps {
  /** Open + select an existing function (switches to its canvas). */
  onOpenFunction: (id: string) => void;
  /** Create a new function and open it. */
  onCreateFunction: () => string;
}

/**
 * Always-present sidebar list of project-scoped functions, mirroring the
 * channels/memory/models panels. Selecting a row opens the function (its canvas +
 * the definition config on the right); the badge shows the in→out port counts.
 */
export const FunctionListPanel = ({ onOpenFunction, onCreateFunction }: FunctionListPanelProps) => {
  const { t } = useTranslation();
  const functions = useEditorStore((s) => s.functions);
  const selection = useEditorStore((s) => s.selection);
  const byFunctionId = useDiagnosticsStore((s) => s.byFunctionId);

  const items = Object.values(functions).map((f) => ({
    id: f.id,
    label: f.name,
    inputs: f.arguments.length,
    outputs: f.outputs.length,
  }));

  return (
    <ResourceListPanel
      items={items}
      selectedId={selection.kind === "function" ? selection.id : null}
      onSelect={onOpenFunction}
      diagnosticsSlot={byFunctionId}
      badge={(f) => `${f.inputs}→${f.outputs}`}
      emptyIcon={FunctionSquare}
      emptyText={t("noFunctions")}
      emptyHint={t("addFunctionHint")}
      addActions={[{ label: t("addFunction"), icon: Plus, onAdd: () => onCreateFunction() }]}
    />
  );
};
