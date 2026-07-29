// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import type { TFunction } from "i18next";
import type { NodeDefinition } from "@foresthubai/workflow-core/node";
import type { Parameter } from "@foresthubai/workflow-core/parameter";

/**
 * Convention-based i18n helpers for description strings only.
 *
 * Keys follow the pattern:
 *   nodes.<NodeType>.description
 *   edges.<EdgeType>.description
 *   memory.<MemoryType>.description  /  models.<ModelType>.description
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

// Memory/model definitions are per-type registries like nodes, so they key the
// same way. `family` is the top-level namespace ("memory" | "models"); it doubles
// as the param prefix, which must stay per-type — two types in one family can
// share a parameter id with different meanings (MemoryFile vs VectorDatabase both
// have `description`).
export function getResourceDescription(
  t: TFunction,
  family: string,
  type: string,
  def: { description: string } | undefined,
): string {
  if (!def) return "";
  return t(`${family}.${type}.description`, { defaultValue: def.description });
}
