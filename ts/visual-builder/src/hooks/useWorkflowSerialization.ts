import type { Schemas } from "@foresthub/workflow-core";
import { NodeInstance } from "@foresthub/workflow-core/types/node";
import { ALL_CHANNEL_TYPES, type ChannelInstance, type ChannelType, type EditorChannelSchema } from "@foresthub/workflow-core/types/channel";
import {
  serialize as serializeChannel,
  deserialize as deserializeChannel,
} from "@foresthub/workflow-core/types/channel";
import type { MemoryFileInstance } from "@foresthub/workflow-core/types/memory";
import {
  serialize as serializeMemoryFile,
  deserialize as deserializeMemoryFile,
} from "@foresthub/workflow-core/types/memory";
import { deserialize, serialize } from "@foresthub/workflow-core/types/node/NodeSerialization";
import { isNodeUsedAsTool } from "../utils/portUtils";
import type { EdgeInstance, EdgeType } from "@foresthub/workflow-core/types/edge";
import { Edge, Node } from "@xyflow/react";
import { useCallback } from "react";
import {
  clearAllCanvasStores,
  MAIN_CANVAS_ID,
  getOrCreateCanvasStore,
  getAllCanvasStores,
  notifyFunctionRegistryChange,
} from "../store/canvasStore";
import { useEditorStore } from "../store/editorStore";
import { getReactFlowType } from "../utils/graphOperations";
import { channelKey } from "../utils/channels";
import { memoryFileKey } from "../utils/memoryFiles";
import { declaredVarKey } from "../utils/variables";
import type { CanvasVariable } from "../utils/variables";
import { ensureUids } from "../utils/variables";

/**
 * Hook for converting between Zustand canvas stores and the strict API format (Schemas["Workflow"]).
 * Used for code generation and template loading.
 * NOT used for save/auto-save (those use domain snapshots).
 */
export function useWorkflowSerialization() {
  /**
   * Import strict API JSON (Schemas["Workflow"]) into Zustand stores.
   * Uses deserialize() which fills defaults for required fields.
   */
  const importProject = useCallback((project: Schemas["Workflow"]): void => {
    clearAllCanvasStores();

    // Load main canvas (getOrCreateCanvasStore ensures it exists)
    const mainCanvas = getOrCreateCanvasStore(MAIN_CANVAS_ID);
    mainCanvas.getState().initialize(
      project.nodes.map(toReactFlowNode).filter((n): n is Node<NodeInstance> => n !== undefined),
      project.edges.map(toReactFlowEdge),
    );
    if (project.declaredVariables?.length) {
      mainCanvas.getState().setVariables((vars) => {
        const updated = { ...vars };
        for (const dv of project.declaredVariables!) {
          updated[declaredVarKey(dv.uid)] = {
            kind: "declared",
            uid: dv.uid,
            name: dv.name,
            dataType: dv.dataType,
            ...(dv.initialValue !== undefined ? { initialValue: dv.initialValue } : {}),
          };
        }
        return updated;
      });
    }

    // Load function canvases
    project.functions.forEach((fn) => {
      const functionInfo = fn.functionInfo;
      functionInfo.arguments = ensureUids(functionInfo.arguments);
      functionInfo.returns = ensureUids(functionInfo.returns);

      const canvasStore = getOrCreateCanvasStore(functionInfo.id);
      canvasStore.getState().initialize(
        fn.nodes.map(toReactFlowNode).filter((n): n is Node<NodeInstance> => n !== undefined),
        fn.edges.map(toReactFlowEdge),
        functionInfo,
        fn.outputAssignments,
      );
      if (fn.declaredVariables?.length) {
        canvasStore.getState().setVariables((vars) => {
          const updated = { ...vars };
          for (const dv of fn.declaredVariables!) {
            updated[declaredVarKey(dv.uid)] = {
              kind: "declared",
              uid: dv.uid,
              name: dv.name,
              dataType: dv.dataType,
              ...(dv.initialValue !== undefined ? { initialValue: dv.initialValue } : {}),
            };
          }
          return updated;
        });
      }
    });

    // Import channels: strip the deploy-only driverId via per-type
    // deserialize. Entries with unknown/unsupported types (e.g. MQTT) are
    // dropped silently — the editor only handles the IO subset.
    if (project.channels?.length) {
      useEditorStore.getState().setChannels(() => normalizeChannels(project.channels));
    }

    // Import memory files: 1:1 mapping, just rehome under the canonical key.
    if (project.memoryFiles?.length) {
      useEditorStore.getState().setMemoryFiles(() => {
        const out: Record<string, MemoryFileInstance> = {};
        for (const m of project.memoryFiles!) {
          const instance = deserializeMemoryFile(m);
          out[memoryFileKey(instance.uid)] = instance;
        }
        return out;
      });
    }

    notifyFunctionRegistryChange();
  }, []);

  /**
   * Export Zustand stores to strict API format (Schemas["Workflow"]).
   * Used for code generation.
   */
  const exportProject = useCallback((): Schemas["Workflow"] => {
    const mainCanvas = getOrCreateCanvasStore(MAIN_CANVAS_ID);
    const mainState = mainCanvas.getState();
    const mainNodes = mainState.nodes.map((n) => serialize(n.data, n.position, isNodeUsedAsTool(n.id, n.data, mainState.edges)));
    const mainEdges = mainState.edges.map(toApiEdge);
    const mainDeclaredVariables = extractDeclaredVariables(mainState.variables);

    const allStores = getAllCanvasStores();
    const apiFunctions = Object.entries(allStores)
      .filter(([id]) => id !== MAIN_CANVAS_ID)
      .map(([id, canvas]) => {
        const state = canvas.getState();
        const functionInfo = state.functionInfo;

        if (!functionInfo) {
          console.warn(`Function ${id} has no functionInfo in canvas store`);
          return null;
        }

        const funcDeclaredVariables = extractDeclaredVariables(state.variables);
        const funcNodes = state.nodes.map((n) => serialize(n.data, n.position, isNodeUsedAsTool(n.id, n.data, state.edges)));

        return {
          functionInfo,
          outputAssignments: state.outputAssignments,
          nodes: funcNodes,
          edges: state.edges.map(toApiEdge),
          declaredVariables: funcDeclaredVariables,
        };
      })
      .filter((fn): fn is NonNullable<typeof fn> => fn !== null);

    // Domain → API Channels. Each entry serializes to its discriminated
    // variant; driverId is emitted as "" — deploy binds the real value
    // against the device manifest at deploy time.
    const channels = Object.values(useEditorStore.getState().channels).map(serializeChannel);

    // Domain → API memory files. Same shape on both sides.
    const memoryFiles = Object.values(useEditorStore.getState().memoryFiles).map(serializeMemoryFile);

    return {
      nodes: mainNodes,
      edges: mainEdges,
      functions: apiFunctions,
      declaredVariables: mainDeclaredVariables,
      channels,
      ...(memoryFiles.length > 0 ? { memoryFiles } : {}),
    };
  }, []);

  return {
    exportProject,
    importProject,
  };
}

// ============================================================================
// Channel Normalization (API → domain)
// ============================================================================

const KNOWN_CHANNEL_TYPES = new Set<ChannelType>(ALL_CHANNEL_TYPES);

/**
 * Convert API Channel[] → domain record. Each entry is per-type
 * deserialized to lift hardware fields into `arguments` and drop deploy-time
 * bindings. Silently skips entries whose `type` is not in the known set
 * (forward compatibility — unknown future variants are ignored, not crashed).
 */
export function normalizeChannels(apiChannels: readonly Schemas["Channel"][] | undefined): Record<string, ChannelInstance> {
  const out: Record<string, ChannelInstance> = {};
  if (!apiChannels) return out;
  for (const v of apiChannels) {
    if (!KNOWN_CHANNEL_TYPES.has(v.type as ChannelType)) continue;
    out[channelKey(v.id)] = deserializeChannel(v as EditorChannelSchema);
  }
  return out;
}

// ============================================================================
// Variable Extraction Helper
// ============================================================================

function extractDeclaredVariables(variables: Record<string, CanvasVariable>): Schemas["Variable"][] {
  const result: Schemas["Variable"][] = [];
  for (const v of Object.values(variables)) {
    if (v.kind === "declared") {
      result.push({
        uid: v.uid,
        name: v.name,
        dataType: v.dataType,
        ...(v.initialValue !== undefined ? { initialValue: v.initialValue } : {}),
      });
    }
  }
  return result;
}

// ============================================================================
// Private Conversion Helpers
// ============================================================================

function toReactFlowNode(apiNode: Schemas["Node"]): Node<NodeInstance> | undefined {
  const nodeData = deserialize(apiNode);
  return {
    id: nodeData.id,
    type: getReactFlowType(nodeData.type),
    position: apiNode.position,
    data: nodeData,
  };
}

function toReactFlowEdge(conn: Schemas["Edge"], index: number): Edge<EdgeInstance> {
  let data: EdgeInstance | undefined;

  if ((conn.type === "agentTask" || conn.type === "agentDelegate") && conn.prompt) {
    data = { ...data, prompt: conn.prompt };
  }
  if ((conn.type === "agentChoice" || conn.type === "agentDelegate") && conn.description) {
    data = { ...data, description: conn.description };
  }

  return {
    id: `e${index + 1}`,
    type: conn.type,
    source: conn.from.nodeId,
    sourceHandle: conn.from.port,
    target: conn.to.nodeId,
    targetHandle: conn.to.port,
    ...(data ? { data } : {}),
  };
}

function toApiEdge(edge: Edge<EdgeInstance>): Schemas["Edge"] {
  const sourceHandle = edge.sourceHandle || "";
  const targetHandle = edge.targetHandle || "";
  const edgeType = edge.type as EdgeType | undefined;
  const from = { nodeId: edge.source, port: sourceHandle };
  const to = { nodeId: edge.target, port: targetHandle };

  switch (edgeType) {
    case "agentTask":
      return {
        type: "agentTask",
        from,
        to,
        prompt: (edge.data?.prompt as Schemas["Expression"]) ?? { expression: "", references: [], dataType: "string" },
      };
    case "agentChoice":
      return {
        type: "agentChoice",
        from,
        to,
        ...(edge.data?.description ? { description: edge.data.description as string } : {}),
      };
    case "agentDelegate":
      return {
        type: "agentDelegate",
        from,
        to,
        ...(edge.data?.prompt ? { prompt: edge.data.prompt as Schemas["Expression"] } : {}),
        ...(edge.data?.description ? { description: edge.data.description as string } : {}),
      };
    case "control":
      return { type: "control", from, to };
    case "tool":
      return { type: "tool", from, to };
    default:
      return {
        type: sourceHandle.startsWith("ctrl") || targetHandle.startsWith("ctrl") ? "control" : "tool",
        from,
        to,
      };
  }
}
