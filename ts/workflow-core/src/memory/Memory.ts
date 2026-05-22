import type { Schemas } from "../api";

export type MemoryType = "MemoryFile" | "VectorDatabase";

export const ALL_MEMORY_TYPES: MemoryType[] = ["MemoryFile", "VectorDatabase"];

export interface Memory {
  id: string;
  label: string;
  type: MemoryType;
  arguments: Record<string, unknown>;
}

/** Reference from an agent node to a declared MemoryFile, with access mode. Round-trips 1:1 with the API. */
export type MemoryRef = Schemas["MemoryRef"];
