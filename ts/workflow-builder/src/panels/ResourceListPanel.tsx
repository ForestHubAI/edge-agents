import { AlertTriangle, type LucideIcon } from "lucide-react";
import { AddButton } from "../components/ui/add-button";
import { cn } from "../cn";
import { useEditorStore } from "../stores/editorStore";
import { isReadOnly } from "../WorkflowBuilder";
import type { Diagnostic } from "@foresthubai/workflow-core/diagnostics";

interface ResourceListItem {
  id: string;
  label: string;
}

interface AddAction {
  label: string;
  icon: LucideIcon;
  onAdd: () => void;
}

interface ResourceListPanelProps<I extends ResourceListItem> {
  items: I[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** The matching diagnostics slot (byChannelId / byMemoryId / byModelId). */
  diagnosticsSlot: Record<string, Diagnostic[]>;
  /** Short type-badge text shown on the right of each row. */
  badge: (item: I) => string;
  emptyIcon: LucideIcon;
  emptyText: string;
  emptyHint: string;
  /** One add button (channels/models) or several (memory: File + Vector). */
  addActions: AddAction[];
}

/**
 * Shared sidebar list for the project-scoped primitive resources (channels,
 * memory, declared models): a selectable row per item with an error ring +
 * warning icon driven by the diagnostics slot, a type badge, and add button(s).
 * Variables are not listed here — they're canvas-scoped, sectioned, and don't
 * use this error-badge model.
 */
export function ResourceListPanel<I extends ResourceListItem>({
  items,
  selectedId,
  onSelect,
  diagnosticsSlot,
  badge,
  emptyIcon: EmptyIcon,
  emptyText,
  emptyHint,
  addActions,
}: ResourceListPanelProps<I>) {
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));

  const addButtons = (
    <div className="flex flex-col gap-1.5">
      {addActions.map(({ label, icon, onAdd }) => (
        <AddButton key={label} icon={icon} onClick={onAdd}>
          {label}
        </AddButton>
      ))}
    </div>
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <EmptyIcon className="w-10 h-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">{emptyText}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">{emptyHint}</p>
        {!readOnly && <div className="mt-3 w-full px-2">{addButtons}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {items.map((item) => {
        const isSelected = selectedId === item.id;
        const hasError = (diagnosticsSlot[item.id] ?? []).some((d) => d.severity === "error");
        return (
          <div
            key={item.id}
            onClick={() => onSelect(item.id)}
            className={cn(
              // Background/shadow come from selection; border/ring come from error
              // status. Layered, not exclusive — so a selected row with an error
              // keeps its red outline against the green selection tint instead of
              // hiding the very signal the user is acting on.
              "p-3 rounded-lg transition-all cursor-pointer border ring-1",
              isSelected ? "bg-accent shadow-md" : "bg-card shadow-sm hover:shadow-md",
              hasError
                ? "border-destructive ring-destructive"
                : isSelected
                  ? "border-primary/40 ring-primary/40"
                  : "border-border ring-transparent",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-foreground truncate flex items-center gap-1.5">
                {hasError && <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                {item.label}
              </span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground shrink-0">
                {badge(item)}
              </span>
            </div>
          </div>
        );
      })}
      {!readOnly && <div className="pt-1">{addButtons}</div>}
    </div>
  );
}
