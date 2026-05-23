import type { Schemas } from "../api";
import type { Edge, EdgeData } from "./Edge";
import type { EdgeType } from "./EdgeType";

export type ApiEdge = Schemas["Edge"];

/**
 * Serialize a domain {@link Edge} to the api `Edge`. The `id` is preserved
 * (the api requires it). Edge-type-conditional metadata (`prompt`,
 * `description`) is reattached from the edge's `data` payload.
 */
export function serialize(edge: Edge): ApiEdge {
  const sourceHandle = edge.sourceHandle || "";
  const targetHandle = edge.targetHandle || "";
  const edgeType = edge.type as EdgeType | undefined;
  const from = { nodeId: edge.source, port: sourceHandle };
  const to = { nodeId: edge.target, port: targetHandle };

  switch (edgeType) {
    case "agentTask":
      return {
        id: edge.id,
        type: "agentTask",
        from,
        to,
        prompt: (edge.data?.prompt as Schemas["Expression"]) ?? { expression: "", references: [], dataType: "string" },
      };
    case "agentChoice":
      return {
        id: edge.id,
        type: "agentChoice",
        from,
        to,
        ...(edge.data?.description ? { description: edge.data.description as string } : {}),
      };
    case "agentDelegate":
      return {
        id: edge.id,
        type: "agentDelegate",
        from,
        to,
        ...(edge.data?.prompt ? { prompt: edge.data.prompt as Schemas["Expression"] } : {}),
        ...(edge.data?.description ? { description: edge.data.description as string } : {}),
      };
    case "control":
      return { id: edge.id, type: "control", from, to };
    case "tool":
      return { id: edge.id, type: "tool", from, to };
    default:
      return {
        id: edge.id,
        type: sourceHandle.startsWith("ctrl") || targetHandle.startsWith("ctrl") ? "control" : "tool",
        from,
        to,
      };
  }
}

/**
 * Convert an api `Edge` into a domain {@link Edge}. The api's `id` is preserved
 * verbatim (earlier code synthesized `e${index+1}`, breaking roundtrip
 * identity). Edge-type-conditional metadata (`prompt` on agentTask/agentDelegate;
 * `description` on agentChoice/agentDelegate) is folded into `data` as
 * {@link EdgeData}.
 */
export function deserialize(apiEdge: ApiEdge): Edge {
  let data: EdgeData | undefined;
  if ((apiEdge.type === "agentTask" || apiEdge.type === "agentDelegate") && apiEdge.prompt) {
    data = { ...data, prompt: apiEdge.prompt };
  }
  if ((apiEdge.type === "agentChoice" || apiEdge.type === "agentDelegate") && apiEdge.description) {
    data = { ...data, description: apiEdge.description };
  }
  return {
    id: apiEdge.id,
    type: apiEdge.type,
    source: apiEdge.from.nodeId,
    sourceHandle: apiEdge.from.port,
    target: apiEdge.to.nodeId,
    targetHandle: apiEdge.to.port,
    ...(data ? { data } : {}),
  };
}
