import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { ChevronRight, Trash2 } from "lucide-react";
import { getEdgeDefinition } from "@foresthub/workflow-core/types/edge";
import type { EdgeInstance, EdgeType } from "@foresthub/workflow-core/types/edge";
import ParameterEditor from "../inputs/ParameterEditor";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { getEdgeDescription } from "../utils/translation";

interface EdgeConfigPanelProps {
  canvasId: string;
  edgeId: string;
  edgeType: EdgeType;
  edgeData: EdgeInstance;
  sourceControlEdgeCount: number;
  onEdgeUpdate: (edgeId: string, updates: Record<string, unknown>) => void;
  onEdgeDelete: (edgeId: string) => void;
  onClose: () => void;
}

export const EdgeConfigPanel = ({
  canvasId,
  edgeId,
  edgeType,
  edgeData,
  sourceControlEdgeCount,
  onEdgeUpdate,
  onEdgeDelete,
  onClose,
}: EdgeConfigPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const definition = getEdgeDefinition(edgeType);

  // Read per-parameter error state from diagnostics store
  const edgeDiags = useDiagnosticsStore((s) => s.byEdgeId[edgeId]);
  const paramErrors = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!edgeDiags) return map;
    for (const d of edgeDiags) {
      if (d.paramId && d.severity === "error") {
        const arr = map.get(d.paramId);
        if (arr) arr.push(d.message);
        else map.set(d.paramId, [d.message]);
      }
    }
    return map;
  }, [edgeDiags]);

  const handleParamChange = useCallback(
    (paramId: string, value: unknown) => {
      onEdgeUpdate(edgeId, { [paramId]: value });
    },
    [edgeId, onEdgeUpdate],
  );

  return (
    <div className="p-4 space-y-4">
      {/* Header - matches NodeConfigPanel layout */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg">{definition.label}</h3>
          <p className="text-sm text-muted-foreground">{getEdgeDescription(t, definition, edgeType)}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      {readOnly && (
        <div className="text-xs font-medium text-muted-foreground bg-muted/50 rounded px-2 py-1">
          {t("builder.preview.viewOnly")}
        </div>
      )}

      <Separator />

      <div className={readOnly ? "pointer-events-none opacity-60" : ""}>
        {definition.parameters.length > 0 ? (
          definition.parameters.map((param) => {
            const isDescriptionOptional =
              param.id === "description" &&
              sourceControlEdgeCount <= 1 &&
              (edgeType === "agentChoice" || edgeType === "agentDelegate");
            const effectiveParam = isDescriptionOptional ? { ...param, optional: true } : param;

            return (
              <ParameterEditor
                key={param.id}
                canvasId={canvasId}
                parameter={effectiveParam}
                value={edgeData[param.id]}
                allArguments={edgeData}
                onChange={(value) => handleParamChange(param.id, value)}
                errors={paramErrors.get(param.id)}
                translationPrefix={`edges.${edgeType}`}
              />
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("builder.noEdgeParams")}
          </p>
        )}
      </div>

      {!readOnly && (
        <>
          <Separator />
          <Button variant="destructive" className="w-full" onClick={() => onEdgeDelete(edgeId)}>
            <Trash2 className="w-4 h-4 mr-2" />
            {t("builder.deleteEdge")}
          </Button>
        </>
      )}
    </div>
  );
};
