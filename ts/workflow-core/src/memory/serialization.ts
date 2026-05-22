import type { Schemas } from "../api";
import type { Memory } from "./Memory";

export type ApiMemory = Schemas["Memory"];

/**
 * Serialize a domain Memory to the API discriminated-union shape.
 * VectorDatabase's `collectionId` is a deploy-time binding emitted as "" — the
 * deploy step resolves it against a backend collection (mirrors Channel.driverId).
 * MemoryFile drops `maxSizeBytes` when unset (absent and null both mean "unlimited").
 */
export function serialize(mem: Memory): ApiMemory {
  const { id, label, type, arguments: args } = mem;
  switch (type) {
    case "MemoryFile":
      return {
        type,
        id,
        label,
        description: (args.description as string) ?? "",
        content: (args.content as string) ?? "",
        ...(args.maxSizeBytes != null ? { maxSizeBytes: args.maxSizeBytes as number } : {}),
      };
    case "VectorDatabase":
      return {
        type,
        id,
        label,
        collectionId: "",
        ...(args.description != null ? { description: args.description as string } : {}),
      };
  }
}

/**
 * Convert an API Memory into a domain Memory. Deploy-time bindings
 * (VectorDatabase.collectionId) are dropped — they aren't part of editor state.
 */
export function deserialize(api: ApiMemory): Memory {
  const { id, label, type } = api;
  const args: Record<string, unknown> = {};
  switch (type) {
    case "MemoryFile":
      args.description = api.description ?? "";
      args.content = api.content ?? "";
      if (api.maxSizeBytes != null) args.maxSizeBytes = api.maxSizeBytes;
      break;
    case "VectorDatabase":
      if (api.description != null) args.description = api.description;
      break;
  }
  return { id, label, type, arguments: args };
}
