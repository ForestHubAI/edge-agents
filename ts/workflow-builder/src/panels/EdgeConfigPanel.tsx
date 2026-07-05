// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { ChevronRight } from "lucide-react";
import { getEdgeDefinition } from "@foresthubai/workflow-core/edge";
import type { EdgeData, EdgeType } from "@foresthubai/workflow-core/edge";
import ParameterEditor from "../inputs/ParameterEditor";
import { useEditorStore } from "../stores/editorStore";
import { isReadOnly } from "../WorkflowBuilder";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useParamErrors } from "../hooks/useParamErrors";
import { ReadOnlyBanner } from "../components/ui/readonly-banner";
import { DeleteButton } from "../components/ui/delete-button";
import { getEdgeDescription } from "../utils/translation";

interface EdgeConfigPanelProps {
  canvasId: string;
  edgeId: string;
  edgeType: EdgeType;
  edgeData: EdgeData;
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
  const paramErrors = useParamErrors(edgeDiags);

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
      {readOnly && <ReadOnlyBanner />}

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
          <p className="text-sm text-muted-foreground">{t("noEdgeParams")}</p>
        )}
      </div>

      {!readOnly && (
        <>
          <Separator />
          <DeleteButton onClick={() => onEdgeDelete(edgeId)}>{t("deleteEdge")}</DeleteButton>
        </>
      )}
    </div>
  );
};
