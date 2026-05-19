import { cn } from "../../lib/utils";
import { AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";
import { Badge } from "./badge";
import type { Schemas } from "@foresthub/workflow-core";

/**
 * Animated heartbeat dot. Pass `status` for the 4-state agent lifecycle
 * (online / pending / booterror / offline) or the legacy `active` boolean
 * for plain on/off (maps to online/offline).
 */
export function StatusIndicator({
  active,
  status,
  className,
}: {
  active?: boolean;
  status?: Schemas["AgentStatus"];
  className?: string;
}) {
  const effective: Schemas["AgentStatus"] = status ?? (active ? "online" : "offline");

  const dotColor = {
    online: "bg-success",
    pending: "bg-warning",
    booterror: "bg-destructive",
    offline: "bg-muted-foreground/30",
  }[effective];

  // Booterror is static — pulsing red would feel like an alarm. Offline is
  // intentionally still as well.
  const pingColor: string | null = {
    online: "bg-success/80",
    pending: "bg-warning/80",
    booterror: null,
    offline: null,
  }[effective];

  return (
    <span className={cn("relative flex h-2.5 w-2.5", className)}>
      {pingColor && (
        <span
          className={cn(
            "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
            pingColor,
          )}
        />
      )}
      <span className={cn("relative inline-flex rounded-full h-2.5 w-2.5", dotColor)} />
    </span>
  );
}

/**
 * Badge with status dot and text label.
 */
export function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <Badge
      variant={active ? "default" : "outline"}
      className={cn(
        "text-[10px] px-1.5 py-0 gap-1",
        active && "bg-success/15 text-success border-success/30 hover:bg-success/20",
      )}
    >
      <StatusIndicator active={active} className="h-1.5 w-1.5" />
      {label}
    </Badge>
  );
}

/**
 * Yellow warning icon with tooltip for network mismatch.
 */
export function NetworkMismatchWarning({ tooltip }: { tooltip?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 cursor-help" />
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px]">
        {tooltip ?? "Device was moved to a different network since deployment. Redeploy required."}
      </TooltipContent>
    </Tooltip>
  );
}
