import type { Parameter } from "@foresthub/workflow-core/parameter";

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

/** Pick a fresh `<prefix>N` label that doesn't collide with existing labels. */
export function nextDefaultLabel(prefix: string, existingLabels: string[]): string {
  let counter = 1;
  while (existingLabels.includes(`${prefix}${counter}`)) counter++;
  return `${prefix}${counter}`;
}
