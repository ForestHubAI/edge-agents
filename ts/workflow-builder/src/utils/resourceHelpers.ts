import type { Parameter } from "@foresthubai/workflow-core/parameter";

/**
 * Build the initial `arguments` record for a new resource instance: each
 * parameter that declares a `default` gets seeded. Defaults are `structuredClone`d
 * so two instances never share a mutable reference (objects/arrays).
 *
 * Shared by the registry-backed project primitives (memory, model). Channels
 * have conditional, activation-rule parameters and seed inside `channelOperations`
 * instead.
 */
export function seedDefaultArguments(params: Parameter[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of params) {
    if ("default" in param && param.default !== undefined) {
      args[param.id] = structuredClone(param.default);
    }
  }
  return args;
}

/**
 * Return `desired` if it's free, otherwise append 2, 3, 4… until the result
 * doesn't collide with `existing`.
 */
export function uniqueName(desired: string, existing: Iterable<string>): string {
  const taken = existing instanceof Set ? existing : new Set(existing);
  if (!taken.has(desired)) return desired;
  let i = 2;
  while (taken.has(`${desired}${i}`)) i++;
  return `${desired}${i}`;
}
