import { useTranslation } from "react-i18next";
import { Button } from "../components/ui/button";
import { AlertTriangle, Cpu, Plus } from "lucide-react";
import { cn } from "../lib/utils";
import { useDiagnosticsStore } from "../stores/diagnosticsStore";
import { useEditorStore, isReadOnly } from "../stores/editorStore";
import { addChannel } from "../utils/channelOperations";

export const ChannelsPanel = () => {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const { t } = useTranslation();
  const channels = useEditorStore((s) => s.channels);
  const selectedChannelId = useEditorStore((s) => s.selectedChannelId);
  const setSelectedChannelId = useEditorStore((s) => s.setSelectedChannelId);
  const byChannelId = useDiagnosticsStore((s) => s.byChannelId);

  const list = Object.values(channels);

  const handleAdd = () => {
    const created = addChannel("GPIOIN");
    setSelectedChannelId(created.id);
  };

  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Cpu className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">{t("noChannels")}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">{t("noChannelsHint")}</p>
        {!readOnly && (
          <Button variant="outline" size="sm" className="mt-3" onClick={handleAdd}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            {t("addChannel")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {list.map((channel) => {
        const isSelected = selectedChannelId === channel.id;
        const hasError = (byChannelId[channel.id] ?? []).some((d) => d.severity === "error");
        return (
          <div
            key={channel.id}
            onClick={() => setSelectedChannelId(channel.id)}
            className={cn(
              "p-3 rounded-lg transition-all cursor-pointer",
              isSelected
                ? "bg-primary/10 shadow-md border border-primary/40 ring-1 ring-primary/40"
                : hasError
                  ? "bg-card shadow-sm border border-destructive ring-1 ring-destructive"
                  : "bg-card shadow-sm hover:shadow-md",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-foreground truncate flex items-center gap-1.5">
                {hasError && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                {channel.label}
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground shrink-0">
                {channel.type}
              </span>
            </div>
          </div>
        );
      })}
      {!readOnly && (
        <Button variant="outline" size="sm" className="w-full text-xs border-dashed" onClick={handleAdd}>
          <Plus className="w-3.5 h-3.5 mr-1" />
          {t("addChannel")}
        </Button>
      )}
    </div>
  );
};
