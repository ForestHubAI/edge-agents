import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NodeDefinition, NodeCategory } from "@foresthub/workflow-core/node";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "../components/ui/command";
import { categoryIcons } from "../utils/categoryConstants";

interface NodePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  compatibleDefs: NodeDefinition[];
  onSelect: (nodeDef: NodeDefinition) => void;
}

const CATEGORY_ORDER: NodeCategory[] = [
  NodeCategory.Trigger,
  NodeCategory.Input,
  NodeCategory.Logic,
  NodeCategory.Data,
  NodeCategory.Function,
  NodeCategory.AI,
  NodeCategory.Tool,
  NodeCategory.Output,
];

export function NodePickerDialog({ open, onOpenChange, compatibleDefs, onSelect }: NodePickerDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) setSearch("");
  }, [open]);

  // Group definitions by category
  const grouped = new Map<NodeCategory, NodeDefinition[]>();
  for (const def of compatibleDefs) {
    const list = grouped.get(def.category) ?? [];
    list.push(def);
    grouped.set(def.category, list);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder={t("nodePickerSearch", "Search nodes...")}
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>{t("nodePickerEmpty", "No compatible nodes found.")}</CommandEmpty>
        {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((category) => {
          const Icon = categoryIcons[category];
          return (
            <CommandGroup key={category} heading={category}>
              {grouped.get(category)!.map((def) => (
                <CommandItem
                  key={def.type + (def.type === "FunctionCall" ? `-${def.label}` : "")}
                  onSelect={() => {
                    onSelect(def);
                    onOpenChange(false);
                  }}
                >
                  {Icon && <Icon className="mr-2 h-4 w-4 shrink-0 opacity-70" />}
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{def.label}</span>
                    {def.description && (
                      <span className="text-xs text-muted-foreground truncate">{def.description}</span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
