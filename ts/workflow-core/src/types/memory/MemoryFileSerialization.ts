import type { Schemas } from "../../api";
import type { MemoryFileInstance } from "./MemoryFile";

/**
 * Domain → API. Drops `maxSizeBytes` when unset (the API treats absent and
 * null both as "unlimited", and emitting an explicit `null` only inflates the
 * payload).
 */
export function serialize(mem: MemoryFileInstance): Schemas["MemoryFile"] {
  return {
    uid: mem.uid,
    name: mem.name,
    description: mem.description,
    content: mem.content,
    ...(mem.maxSizeBytes != null ? { maxSizeBytes: mem.maxSizeBytes } : {}),
  };
}

/** API → domain. Missing optional fields default to safe values. */
export function deserialize(api: Schemas["MemoryFile"]): MemoryFileInstance {
  return {
    uid: api.uid,
    name: api.name,
    description: api.description ?? "",
    content: api.content ?? "",
    ...(api.maxSizeBytes != null ? { maxSizeBytes: api.maxSizeBytes } : {}),
  };
}
