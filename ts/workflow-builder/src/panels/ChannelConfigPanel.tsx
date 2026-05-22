import { useTranslation } from "react-i18next";
import { CHANNEL_DEFINITION, type ChannelInstance, type ChannelType } from "@foresthub/workflow-core/channel";
import { isParameterActive, type Parameter } from "@foresthub/workflow-core/parameter";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { deleteChannel, updateChannel } from "../utils/channelOperations";
import { ResourceConfigPanel } from "./ResourceConfigPanel";

interface ChannelConfigPanelProps {
  channel: ChannelInstance;
  onClose: () => void;
}

export const ChannelConfigPanel = ({ channel, onClose }: ChannelConfigPanelProps) => {
  const { t } = useTranslation();

  // `type` is a parameter, so it's exposed through the same `arguments`-shaped
  // record ParameterEditor reads — the top-level `type` is mirrored under the
  // `type` key so the activation-rule evaluator can see it.
  const allArguments: Record<string, unknown> = { ...channel.arguments, type: channel.type };
  const parameters = CHANNEL_DEFINITION.parameters.filter((p) => isParameterActive(p, allArguments, false));
  const channelDiags = useDiagnosticsStore((s) => s.byChannelId[channel.id]);

  const handleParamChange = (paramId: string, value: unknown) => {
    if (paramId === "type") {
      updateChannel(channel.id, { type: value as ChannelType });
    } else {
      updateChannel(channel.id, { arguments: { [paramId]: value } });
    }
  };

  return (
    <ResourceConfigPanel
      resetKey={channel.id}
      label={channel.label}
      labelTitle={t("channelLabel", "Channel label")}
      onLabelChange={(label) => updateChannel(channel.id, { label })}
      description={t("channelDescription", "Hardware interface declaration")}
      parameters={parameters}
      getValue={(p: Parameter) => (p.id === "type" ? channel.type : channel.arguments[p.id])}
      allArguments={allArguments}
      onParamChange={handleParamChange}
      diagnostics={channelDiags}
      translationPrefix="channels"
      deleteLabel={t("deleteChannel", "Delete channel")}
      onDelete={() => deleteChannel(channel.id)}
      onClose={onClose}
    />
  );
};
