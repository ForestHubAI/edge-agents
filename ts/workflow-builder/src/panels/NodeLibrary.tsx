// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { Badge } from "../components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { NodeCategory } from "@foresthubai/workflow-core/node";
import type { FunctionDeclaration } from "@foresthubai/workflow-core/function";
import { ChevronDown, ChevronDown as DropdownIcon, Hash, Search, ToggleLeft, Type } from "lucide-react";
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { NodeDefinition } from "@foresthubai/workflow-core/node";
import { categoryIcons, categoryColors } from "../utils/categoryConstants";
import { useEditorStore } from "../stores/editorStore";
import { isReadOnly } from "../mode";
import { FunctionNodeDefinition } from "@foresthubai/workflow-core/node";
import { Parameter } from "@foresthubai/workflow-core/parameter";
import { getNodeDescription } from "../utils/translation";

const getParameterIcon = (type: string) => {
  switch (type) {
    case "string":
      return Type;
    case "number":
    case "int":
    case "float":
      return Hash;
    case "boolean":
    case "bool":
      return ToggleLeft;
    case "dropdown":
    case "selection":
      return DropdownIcon;
    default:
      return Type;
  }
};

const getParameterTypeLabel = (type: string, t: TFunction) => {
  switch (type) {
    case "string":
      return t("paramTypeText");
    case "int":
    case "float":
    case "number":
      return t("paramTypeNumber");
    case "boolean":
    case "bool":
      return t("paramTypeBoolean");
    case "dropdown":
    case "selection":
      return t("paramTypeSelection");
    case "expression":
      return t("paramTypeExpression");
    default:
      return type;
  }
};

const ParameterTooltip: React.FC<{
  parameters: Parameter[];
  t: TFunction;
}> = ({ parameters, t }) => {
  if (parameters.length === 0) return null;

  return (
    <div className="space-y-2 max-w-sm">
      <div className="font-medium text-sm">{t("parametersLabel")}</div>
      {parameters.map((param, index) => {
        const IconComponent = getParameterIcon(param.type);
        const isOptional = param.optional === true;
        return (
          <div key={index} className="space-y-1">
            <div className="flex items-center gap-2">
              <IconComponent className="w-3 h-3" />
              <span className="font-medium text-sm">{param.label}</span>
              {!isOptional ? (
                <Badge variant="destructive" className="text-xs">
                  {t("required")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  {t("optional")}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground pl-5">
              {t("typeLabel")} {getParameterTypeLabel(param.type, t)}
              {param.default !== undefined && (
                <span>
                  {" "}
                  • {t("defaultLabel")} {String(param.default)}
                </span>
              )}
              {"options" in param && param.options && (
                <span>
                  {" "}
                  • {t("optionsLabel")} {param.options.map((o) => o.label || o.value).join(", ")}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

interface NodeLibraryProps {
  onAddNode: (nodeType: NodeDefinition, position?: { x: number; y: number }) => void;
  nodeDefinitions: NodeDefinition[];
  getAllCategories: () => NodeCategory[];
  functions: FunctionDeclaration[];
  isFunctionCanvas: boolean;
}

const NodeLibrary = ({
  onAddNode,
  nodeDefinitions,
  getAllCategories,
  functions,
  isFunctionCanvas,
}: NodeLibraryProps) => {
  const { t } = useTranslation();
  const readOnly = useEditorStore((s) => isReadOnly(s.builderMode));
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const search = searchTerm.toLowerCase();
  const filteredNodes = nodeDefinitions.filter(
    (node) =>
      !node.isUnremovable &&
      !(isFunctionCanvas && node.category === NodeCategory.Trigger) &&
      // Search filter: label, category, or any tag
      (node.label.toLowerCase().includes(search) ||
        node.category.toLowerCase().includes(search) ||
        (node.tags ?? []).some((tag) => tag.toLowerCase().includes(search))),
  );

  // Get categories that have matching nodes when searching
  const categoriesWithMatches = new Set(filteredNodes.map((node) => node.category));

  const toggleCategory = (category: NodeCategory) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(category)) {
      newExpanded.delete(category);
    } else {
      newExpanded.add(category);
    }
    setExpandedCategories(newExpanded);
  };

  // When searching, auto-expand categories with matches
  const isCategoryExpanded = (category: NodeCategory) => {
    if (searchTerm.trim() && categoriesWithMatches.has(category)) {
      return true;
    }
    return expandedCategories.has(category);
  };

  const hasResults = filteredNodes.length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Search */}
      <div className="relative shrink-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={t("searchBlocks")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 h-9 rounded-lg"
        />
      </div>

      <ScrollArea className="flex-1 mt-3">
        {/* disableHoverableContent: close the tooltip as soon as the cursor
            leaves the tile, instead of keeping it open when the pointer moves
            onto the description itself. */}
        <TooltipProvider disableHoverableContent>
          {/* px-1 keeps tile hover borders off the scroll-clip edge */}
          <div className="flex flex-col gap-0.5 px-1 pb-4">
            {!hasResults && (
              <p className="text-sm text-muted-foreground text-center py-10">{t("noResults", "No matching nodes")}</p>
            )}
            {getAllCategories().map((category) => {
              const categoryNodes = filteredNodes.filter((node) => node.category === category);
              if (categoryNodes.length === 0) return null;

              const isExpanded = isCategoryExpanded(category);
              const CategoryIcon = categoryIcons[category];
              const iconChipClass = categoryColors[category] ?? "bg-muted text-muted-foreground border-border";

              return (
                <Collapsible key={category} open={isExpanded} onOpenChange={() => toggleCategory(category)}>
                  <CollapsibleTrigger className="flex items-center gap-2 w-full px-2 py-1.5 rounded-md text-left hover:bg-muted/50 transition-colors group">
                    <ChevronDown
                      className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${
                        isExpanded ? "" : "-rotate-90"
                      }`}
                    />
                    {CategoryIcon && <CategoryIcon className="w-4 h-4 text-muted-foreground shrink-0" />}
                    <span className="flex-1 font-medium text-sm truncate">{category}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{categoryNodes.length}</span>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="grid grid-cols-2 gap-1.5 px-1 pt-1.5 pb-2">
                      {categoryNodes.map((nodedef) => {
                        const staticParams = nodedef.parameters;
                        const nodeKey = `${nodedef.type}-${"functionInfo" in nodedef ? (nodedef as FunctionNodeDefinition).functionInfo.id : ""}`;
                        const hasParams = staticParams.length > 0;
                        const description = getNodeDescription(t, nodedef);
                        const firstTag = nodedef.tags?.[0];

                        const tile = (
                          <button
                            type="button"
                            draggable={!readOnly}
                            onDragStart={
                              readOnly
                                ? undefined
                                : (e) => {
                                    const dragData = { nodeDef: nodedef };
                                    e.dataTransfer.setData("application/json", JSON.stringify(dragData));
                                    e.dataTransfer.effectAllowed = "copy";
                                  }
                            }
                            onClick={readOnly ? undefined : () => onAddNode(nodedef)}
                            disabled={readOnly}
                            className={`relative flex flex-col items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-center transition-colors duration-150 ${
                              readOnly
                                ? "opacity-60 cursor-default"
                                : "cursor-grab active:cursor-grabbing hover:border-primary/50 hover:bg-accent/40"
                            }`}
                          >
                            <div
                              className={`flex items-center justify-center w-9 h-9 rounded-lg border ${iconChipClass}`}
                            >
                              {CategoryIcon && <CategoryIcon className="w-4 h-4" />}
                            </div>
                            <span className="text-[11px] font-medium leading-tight line-clamp-2 w-full">
                              {nodedef.label}
                            </span>
                            {firstTag && (
                              <Badge
                                variant="secondary"
                                className="absolute top-1 right-1 text-[9px] h-3.5 px-1 font-normal leading-none"
                              >
                                {firstTag}
                              </Badge>
                            )}
                          </button>
                        );

                        const hasTooltipContent = description || hasParams;
                        if (!hasTooltipContent) {
                          return <React.Fragment key={nodeKey}>{tile}</React.Fragment>;
                        }

                        return (
                          <Tooltip key={nodeKey} delayDuration={300}>
                            <TooltipTrigger asChild>{tile}</TooltipTrigger>
                            <TooltipContent side="right" className="max-w-sm pointer-events-none">
                              <div className="space-y-2">
                                {description && (
                                  <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
                                )}
                                {hasParams && <ParameterTooltip parameters={staticParams} t={t} />}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        </TooltipProvider>
      </ScrollArea>
    </div>
  );
};

export default NodeLibrary;
