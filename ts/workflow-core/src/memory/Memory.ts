// Domain Memory — the unified primitive for project-declared memory resources,
// modeled on ChannelInstance ({ id, label, type, arguments }). Unlike channels
// (one union definition gated by activation rules), each memory type has its own
// definition registered in MemoryRegistry, mirroring how nodes work. Two variants:
//   - MemoryFile: agent-scoped durable text storage (referenced via MemoryRef).
//   - VectorDatabase: RAG knowledge base (referenced from Retriever nodes). Its
//     backend `collectionId` is a deploy-time binding emitted as "" on serialize.

import type { Schemas } from "../api";

export type MemoryType = "MemoryFile" | "VectorDatabase";

export const ALL_MEMORY_TYPES: MemoryType[] = ["MemoryFile", "VectorDatabase"];

export interface MemoryInstance {
  id: string;
  label: string;
  type: MemoryType;
  arguments: Record<string, unknown>;
}

/** Reference from an agent node to a declared MemoryFile, with access mode. Round-trips 1:1 with the API. */
export type MemoryRef = Schemas["MemoryRef"];
