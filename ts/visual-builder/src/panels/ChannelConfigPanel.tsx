import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";
import { ChevronRight, Trash2 } from "lucide-react";
import { CHANNEL_DEFINITION, type ChannelInstance, type ChannelType } from "@foresthub/workflow-core/types/channel";
import { isParameterActive } from "@foresthub/workflow-core/types/parameter";
import ParameterEditor from "../inputs/ParameterEditor";
import { MAIN_CANVAS_ID } from "../store/canvasStore";
import { useDiagnosticsStore } from "../store/diagnosticsStore";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { deleteChannel, updateChannel } from "../utils/channelOperations";

interface ChannelConfigPanelProps {
  channel: ChannelInstance;
  onClose: () => void;
}

export const ChannelConfigPanel = ({ channel, onClose }: ChannelConfigPanelProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));

  // Local label state mirrors NodeConfigPanel — preserves cursor position on edit.
  const [localLabel, setLocalLabel] = useState(channel.label);
  useEffect(() => {
    setLocalLabel(channel.label);
  }, [channel.id]);

  // `type` is a parameter, so we expose it through the same `arguments`-shaped
  // record that ParameterEditor reads — top-level `type` is mirrored under the
  // `type` key for the activation rule evaluator.
  const allArguments: Record<string, unknown> = { ...channel.arguments, type: channel.type };
  const parameters = CHANNEL_DEFINITION.parameters.filter((p) => isParameterActive(p, allArguments, false));

  // Per-parameter error map, keyed by paramId — same shape NodeConfigPanel uses.
  const channelDiags = useDiagnosticsStore((s) => s.byChannelId[channel.id]);
  const paramErrors = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!channelDiags) return map;
    for (const d of channelDiags) {
      if (d.paramId && d.severity === "error") {
        const arr = map.get(d.paramId);
        if (arr) arr.push(d.message);
        else map.set(d.paramId, [d.message]);
      }
    }
    return map;
  }, [channelDiags]);

  const handleParamChange = (paramId: string, value: unknown) => {
    if (paramId === "type") {
      updateChannel(channel.id, { type: value as ChannelType });
    } else {
      updateChannel(channel.id, { arguments: { [paramId]: value } });
    }
  };

  return (
    <div className="p-4">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="group flex items-center gap-1.5 rounded-md border border-transparent px-1.5 -mx-1.5 hover:border-input focus-within:border-input transition-colors">
              <input
                type="text"
                title={t("builder.channelLabel", "Channel label")}
                className="font-semibold text-lg bg-transparent w-full outline-none cursor-text py-0.5"
                value={localLabel}
                readOnly={readOnly}
                onChange={(e) => {
                  setLocalLabel(e.target.value);
                  updateChannel(channel.id, { label: e.target.value });
                }}
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {t("builder.channelDescription", "Hardware interface declaration")}
            </p>
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
              {parameters.map((param) => (
                <ParameterEditor
                  key={param.id}
                  canvasId={MAIN_CANVAS_ID}
                  parameter={param}
                  value={param.id === "type" ? channel.type : channel.arguments[param.id]}
                  allArguments={allArguments}
                  onChange={(value) => handleParamChange(param.id, value)}
                  errors={paramErrors.get(param.id)}
                  translationPrefix="channels"
                />
              ))}
            </div>
          </>
        )}

        {!readOnly && (
          <>
            <Separator />
            <Button variant="destructive" className="w-full" onClick={() => deleteChannel(channel.id)}>
              <Trash2 className="w-4 h-4 mr-2" />
              {t("builder.deleteChannel", "Delete channel")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};
