import { Button } from "../components/ui/button";
import { Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDebugStore, type ConsoleEntry } from "../store/debugStore";

export const DebugConsolePanel = () => {
  const { t } = useTranslation();
  const entries = useDebugStore((s) => s.console);
  const clearConsole = useDebugStore((s) => s.clearConsole);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div className="h-full flex flex-col bg-background border-t border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {t("debug.console")}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="w-6 h-6 text-muted-foreground hover:text-foreground"
          onClick={clearConsole}
          title={t("debug.clearConsole")}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Console output */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 font-mono text-xs space-y-0.5">
        {entries.length === 0 ? (
          <div className="text-muted-foreground text-center py-4">
            {t("debug.consoleEmpty")}
          </div>
        ) : (
          entries.map((entry) => <ConsoleRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
};

function ConsoleRow({ entry }: { entry: ConsoleEntry }) {
  const time = new Date(entry.timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const colorClass =
    entry.type === "error"
      ? "text-destructive"
      : entry.type === "system"
        ? "text-muted-foreground"
        : "text-foreground";

  return (
    <div className={`flex gap-2 leading-relaxed ${colorClass}`}>
      <span className="text-muted-foreground/50 shrink-0">{time}</span>
      <span className="whitespace-pre-wrap break-all">{entry.text}</span>
    </div>
  );
}
