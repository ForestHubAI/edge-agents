// Shared category icons and colors for node categories in the visual builder.

import { NodeCategory } from "@foresthub/workflow-core/types/node";
import { Bot, Box, Brain, Inbox, Send, Variable, Wrench, Zap, type LucideIcon } from "lucide-react";

export const categoryIcons: Record<string, LucideIcon> = {
  [NodeCategory.Input]: Inbox,
  [NodeCategory.Logic]: Brain,
  [NodeCategory.Data]: Variable,
  [NodeCategory.Output]: Send,
  [NodeCategory.AI]: Bot,
  [NodeCategory.Trigger]: Zap,
  [NodeCategory.Tool]: Wrench,
  [NodeCategory.Function]: Box,
};

export const categoryColors: Record<string, string> = {
  [NodeCategory.Input]: "bg-node-input/10 text-node-input border-node-input/20",
  [NodeCategory.Logic]: "bg-primary/10 text-primary border-primary/20",
  [NodeCategory.Data]: "bg-node-data/10 text-node-data border-node-data/20",
  [NodeCategory.Output]: "bg-node-output/10 text-node-output border-node-output/20",
  [NodeCategory.AI]: "bg-node-agent/10 text-node-agent border-node-agent/20",
  [NodeCategory.Trigger]: "bg-node-trigger/10 text-node-trigger border-node-trigger/20",
  [NodeCategory.Tool]: "bg-node-tool/10 text-node-tool border-node-tool/20",
  [NodeCategory.Function]: "bg-node-function/10 text-node-function border-node-function/20",
};
