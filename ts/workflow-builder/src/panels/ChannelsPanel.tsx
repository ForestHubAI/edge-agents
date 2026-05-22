import { useTranslation } from "react-i18next";
import { Cpu, Plus } from "lucide-react";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useEditorStore } from "../stores/editorStore";
import { addChannel } from "../utils/channelOperations";
import { ResourceListPanel } from "./ResourceListPanel";

export const ChannelsPanel = () => {
  const { t } = useTranslation();
  const channels = useEditorStore((s) => s.channels);
  const selectedChannelId = useEditorStore((s) => s.selectedChannelId);
  const setSelectedChannelId = useEditorStore((s) => s.setSelectedChannelId);
  const byChannelId = useDiagnosticsStore((s) => s.byChannelId);

  return (
    <ResourceListPanel
      items={Object.values(channels)}
      selectedId={selectedChannelId}
      onSelect={setSelectedChannelId}
      diagnosticsSlot={byChannelId}
      badge={(c) => c.type}
      emptyIcon={Cpu}
      emptyText={t("noChannels")}
      emptyHint={t("noChannelsHint")}
      addActions={[{ label: t("addChannel"), icon: Plus, onAdd: () => setSelectedChannelId(addChannel("GPIOIN").id) }]}
    />
  );
};
