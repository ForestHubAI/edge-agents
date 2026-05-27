import type { OutputBinding, FunctionCallNode } from "@foresthubai/workflow-core/node";
import type { Expression } from "@foresthubai/workflow-core";
import { toast } from "../hooks/use-toast";
import i18n from "../i18n";
import { getAllCanvasStores } from "../stores/canvasStore";
import { useEditorStore } from "../stores/editorStore";
import { toFunctionInfo, type FunctionInfo } from "@foresthubai/workflow-core/function";
import { paramKey } from "@foresthubai/workflow-core/variable";
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
    newArgs[key] = existing ? { ...existing, dataType: arg.dataType } : { expression: "", references: [], dataType: arg.dataType };
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

  // Latest call-site signatures come from the project-scoped declarations, projected
  // to the flat snapshot form a FunctionCall stores (expressions dropped).
  const latestFunctions: Record<string, FunctionInfo> = {};
  for (const [id, def] of Object.entries(useEditorStore.getState().functions)) {
    latestFunctions[id] = toFunctionInfo(def);
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

// Automatically migrate FunctionCallNodes whenever a function declaration changes.
// Declarations are non-undo-tracked editorStore edits, so this is a forward-only
// reconcile — no undo can revert a definition out from under its call sites.
let prevFunctions = useEditorStore.getState().functions;
useEditorStore.subscribe((state) => {
  if (state.functions === prevFunctions) return;
  prevFunctions = state.functions;
  migrateFunctionCallNodes();
});
