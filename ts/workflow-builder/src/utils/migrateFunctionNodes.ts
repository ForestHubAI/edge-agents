import type { Expression, FunctionInfo, OutputBinding, FunctionCallNode } from "@foresthub/workflow-core/node";
import { toast } from "../hooks/use-toast";
import i18n from "../i18n";
import { getAllCanvasStores, MAIN_CANVAS_ID, subscribeFunctionInfoChanges } from "../store/canvasStore";
import { paramKey } from "@foresthub/workflow-core/variable";
import { updateNodeInStore } from "./graphOperations";

// ============================================================================
// Single-Node Migration — builds the update payload for updateNodeInStore
// ============================================================================

function buildMigrationUpdate(
  node: FunctionCallNode,
  latest: FunctionInfo,
): { arguments: Record<string, unknown>; functionInfo: FunctionInfo } {
  const oldArgs = node.arguments;
  const newArgs: Record<string, Expression | OutputBinding> = {};

  // Preserve existing input expressions where uid matches; default empty otherwise.
  // Always update dataType to match the latest function definition.
  for (const arg of latest.arguments) {
    const key = paramKey(arg);
    const existing = oldArgs[key] as Expression | undefined;
    newArgs[key] = existing
      ? { ...existing, dataType: arg.dataType }
      : { expression: "", references: [], dataType: arg.dataType };
  }

  // Preserve existing output bindings where uid matches; default emit for new returns.
  for (const ret of latest.returns) {
    const key = paramKey(ret);
    const existing = oldArgs[key] as OutputBinding | undefined;
    newArgs[key] = existing ?? { active: true, mode: "emit", name: ret.name };
  }

  return {
    functionInfo: { ...latest },
    arguments: newArgs,
  };
}

// ============================================================================
// All-Canvas Migration
// ============================================================================

/**
 * Iterate all canvas stores and migrate any stale FunctionCallNodes
 * to match the latest function definitions.
 *
 * Does NOT create undo history entries — migration is automatic and transparent.
 * Uses updateNodeInStore for proper store reactivity.
 */
export function migrateFunctionCallNodes(): void {
  const allStores = getAllCanvasStores();

  // Build lookup of latest function definitions directly from canvas stores
  const latestFunctions: Record<string, FunctionInfo> = {};
  for (const [id, store] of Object.entries(allStores)) {
    if (id === MAIN_CANVAS_ID) continue;
    const info = store.getState().functionInfo;
    if (info) {
      latestFunctions[info.id] = info;
    }
  }

  // Iterate all canvases and migrate stale FunctionCallNodes
  let totalMigrated = 0;

  for (const [, store] of Object.entries(allStores)) {
    const nodes = store.getState().nodes;

    for (const node of nodes) {
      if (node.data.type !== "FunctionCall") continue;

      const fnNode = node.data as FunctionCallNode;
      const latest = latestFunctions[fnNode.functionInfo.id];
      if (!latest) continue;

      // Check if migration is needed (version or name change)
      if (fnNode.functionInfo.version === latest.version && fnNode.functionInfo.name === latest.name) {
        continue;
      }

      updateNodeInStore(store, node.id, buildMigrationUpdate(fnNode, latest));
      totalMigrated++;
    }
  }

  if (totalMigrated > 0) {
    toast({
      title: i18n.t("functionCallNodesMigrated"),
      description: i18n.t("functionCallNodesMigratedDesc", { count: totalMigrated }),
    });
  }
}

// ============================================================================
// Module-Level Subscription
// ============================================================================

// Automatically migrate FunctionCallNodes whenever any function definition changes.
subscribeFunctionInfoChanges(() => {
  migrateFunctionCallNodes();
});
