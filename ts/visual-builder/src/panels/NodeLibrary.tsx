import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
import { Input } from "../components/ui/input";
import { ScrollArea } from "../components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { FunctionInfo, NodeCategory } from "@foresthub/workflow-core/types/node";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  ChevronDown as DropdownIcon,
  Hash,
  Search,
  ToggleLeft,
  Type,
} from "lucide-react";
import type { TFunction } from "i18next";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { NodeDefinition } from "@foresthub/workflow-core/types/node/NodeDefinition";
import { categoryIcons } from "../utils/categoryConstants";
import { useEditorStore, isReadOnly } from "../store/editorStore";
import { FunctionNodeDefinition } from "@foresthub/workflow-core/types/node/FunctionNode";
import { Parameter } from "@foresthub/workflow-core/types/parameter";
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
      return t("builder.paramTypeText");
    case "int":
    case "float":
    case "number":
      return t("builder.paramTypeNumber");
    case "boolean":
    case "bool":
      return t("builder.paramTypeBoolean");
    case "dropdown":
    case "selection":
      return t("builder.paramTypeSelection");
    case "expression":
      return t("builder.paramTypeExpression");
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
      <div className="font-medium text-sm">{t("builder.parametersLabel")}</div>
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
                  {t("builder.required")}
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">
                  {t("builder.optional")}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground pl-5">
              {t("builder.typeLabel")} {getParameterTypeLabel(param.type, t)}
              {param.default !== undefined && (
                <span>
                  {" "}
                  • {t("builder.defaultLabel")} {String(param.default)}
                </span>
              )}
              {"options" in param && param.options && (
                <span>
                  {" "}
                  • {t("builder.optionsLabel")} {param.options.map((o) => o.label || o.value).join(", ")}
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
  functions: FunctionInfo[];
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
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );

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

  return (
    <div className="h-full flex flex-col">
      {/* Search Only */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={t("builder.searchBlocks")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10 h-9 border-border/50 focus:border-primary/50 transition-colors rounded-lg"
        />
      </div>

      <ScrollArea className="flex-1 mt-3">
        <TooltipProvider>
          <div className="space-y-1 py-4">
            {getAllCategories().map((category) => {
              const categoryNodes = filteredNodes.filter((node) => node.category === category);

              if (categoryNodes.length === 0) return null;

              const isExpanded = isCategoryExpanded(category);

              return (
                <div key={category} className="animate-fade-in">
                  <Collapsible open={isExpanded} onOpenChange={() => toggleCategory(category)}>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        className="w-full justify-start p-3 h-auto hover:bg-accent/50 transition-all duration-200 group"
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform duration-200" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground transition-transform duration-200" />
                            )}
                            {(() => {
                              const CategoryIcon = categoryIcons[category];
                              return CategoryIcon ? <CategoryIcon className="w-4 h-4 text-muted-foreground" /> : null;
                            })()}
                          </div>
                          <div className="flex-1 text-left">
                            <span className="font-medium text-sm group-hover:text-primary transition-colors">
                              {category}
                            </span>
                          </div>
                          <Badge
                            variant="secondary"
                            className="text-xs h-5 px-2 bg-muted/50 hover:bg-muted transition-colors"
                          >
                            {categoryNodes.length}
                          </Badge>
                        </div>
                      </Button>
                    </CollapsibleTrigger>

                    <CollapsibleContent className="space-y-1 mt-1 ml-2">
                      {categoryNodes.map((nodedef) => {
                        // Get static parameters (no node instance)
                        const staticParams = nodedef.parameters;
                        const nodeKey = `${nodedef.type}-${"functionInfo" in nodedef ? (nodedef as FunctionNodeDefinition).functionInfo.id : ""}`;
                        const hasParams = staticParams.length > 0;

                        const description = getNodeDescription(t, nodedef);

                        const card = (
                          <Card
                            draggable={!readOnly}
                            onDragStart={readOnly ? undefined : (e) => {
                              const dragData = { nodeDef: nodedef };
                              e.dataTransfer.setData("application/json", JSON.stringify(dragData));
                              e.dataTransfer.effectAllowed = "copy";
                            }}
                            className={`px-3 py-2 transition-all duration-150 border-border/50 group ${
                              readOnly
                                ? "opacity-60 cursor-default"
                                : "hover:bg-accent/10 cursor-grab active:cursor-grabbing hover:shadow-sm hover:border-primary/20"
                            }`}
                            onClick={readOnly ? undefined : () => onAddNode(nodedef)}
                          >
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-[13px] truncate flex-1 group-hover:text-primary transition-colors">
                                {nodedef.label}
                              </h4>
                              {nodedef.tags && nodedef.tags.length > 0 && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {nodedef.tags.map((tag) => (
                                    <Badge
                                      key={tag}
                                      variant="secondary"
                                      className="text-[10px] h-4 px-1.5 font-normal"
                                    >
                                      {tag}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                              <CheckCircle className="w-3 h-3 text-success opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </div>
                          </Card>
                        );

                        const hasTooltipContent = description || hasParams;

                        if (!hasTooltipContent) {
                          return <React.Fragment key={nodeKey}>{card}</React.Fragment>;
                        }

                        return (
                          <Tooltip key={nodeKey} delayDuration={300}>
                            <TooltipTrigger asChild>{card}</TooltipTrigger>
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
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              );
            })}
          </div>
        </TooltipProvider>
      </ScrollArea>
    </div>
  );
};

export default NodeLibrary;
