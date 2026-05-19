import type { TFunction } from "i18next";
import type { NodeDefinition } from "@foresthub/workflow-core/types/node/NodeDefinition";
import type { Parameter } from "@foresthub/workflow-core/types/parameter";

/**
 * Convention-based i18n helpers for description strings only.
 *
 * Keys follow the pattern:
 *   nodes.<NodeType>.description
 *   edges.<EdgeType>.description
 *   <prefix>.params.<paramId>.description
 *
 * Labels, categories, port names, and option labels stay as raw English code values.
 * Only natural-language descriptions are translated.
 */

export function getNodeDescription(t: TFunction, def: NodeDefinition): string {
  return t(`nodes.${def.type}.description`, { defaultValue: def.description });
}

export function getParamDescription(t: TFunction, translationPrefix: string, param: Parameter): string {
  if (!param.description) return "";
  return t(`${translationPrefix}.params.${param.id}.description`, { defaultValue: param.description });
}

export function getEdgeDescription(t: TFunction, def: { description: string }, portType: string): string {
  return t(`edges.${portType}.description`, { defaultValue: def.description });
}
