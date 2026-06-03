import type { Workflow } from "../workflow";
import { NodeRegistry, isNodeUsedAsTool } from "../node";
import { isParameterActive } from "../parameter";

/**
 * Model ids that nodes reference but the workflow does not declare in `models`.
 * A `modelSelect` accepts exactly two sources — declared custom models and the
 * static catalog — so any referenced id that isn't a declared model is a catalog
 * model: it carries no declared config, yet still needs a provider/credential
 * supplied at deploy.
 *
 * This is the one deploy demand the workflow's resource arrays can't express:
 * channels/memory/declared-models are enumerable directly from
 * `workflow.{channels,memory,models}`, but catalog model ids live only on the
 * nodes that pick them — hence the walk. Spans every canvas (main + function
 * bodies) and honors parameter activation, so a model behind an inactive
 * `modelSelect` (pruned on serialize, never deployed) is not counted.
 */
export function getReferencedCatalogModelIds(workflow: Workflow): string[] {
  const declaredModel = new Set(Object.keys(workflow.models));
  const catalogIds = new Set<string>();

  for (const canvas of Object.values(workflow.canvases)) {
    for (const node of canvas.nodes) {
      const def = NodeRegistry.getByType(node.type);
      if (!def) continue;
      const args = node.arguments as Record<string, unknown>;
      const isToolInput = isNodeUsedAsTool(node.id, node, canvas.edges);
      for (const param of def.parameters) {
        if (param.type !== "modelSelect") continue;
        if (!isParameterActive(param, args, isToolInput)) continue;
        const id = args[param.id];
        if (typeof id === "string" && id !== "" && !declaredModel.has(id)) {
          catalogIds.add(id);
        }
      }
    }
  }

  return [...catalogIds];
}
