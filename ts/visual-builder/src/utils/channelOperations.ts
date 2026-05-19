import { CHANNEL_DEFINITION, type ChannelType, type ChannelInstance, stripInactiveArguments } from "@foresthub/workflow-core/types/channel";
import { isParameterActive } from "@foresthub/workflow-core/types/parameter";
import { useEditorStore } from "../store/editorStore";
import { generateId } from "./IDs";
import { channelKey } from "./channels";

/**
 * Build the initial `arguments` record for a new channel: each parameter
 * that's active for the chosen `type` and has a `default` gets seeded.
 */
function defaultArguments(type: ChannelType): Record<string, unknown> {
  const seed: Record<string, unknown> = { type };
  const args: Record<string, unknown> = {};
  for (const param of CHANNEL_DEFINITION.parameters) {
    if (param.id === "type") continue;
    if (param.activationRules?.length && !isParameterActive(param, seed, false)) continue;
    if ("default" in param && param.default !== undefined) {
      args[param.id] = param.default;
    }
  }
  return args;
}

/** Pick a fresh `chN` label that doesn't collide with existing channels. */
function nextDefaultLabel(existingLabels: string[]): string {
  let counter = 1;
  while (existingLabels.includes(`ch${counter}`)) counter++;
  return `ch${counter}`;
}

/**
 * Create a new channel in the editor store. Returns the new instance.
 */
export function addChannel(type: ChannelType = "GPIOIN"): ChannelInstance {
  const id = generateId("ch");
  const existing = Object.values(useEditorStore.getState().channels).map((v) => v.label);
  const instance: ChannelInstance = {
    id,
    label: nextDefaultLabel(existing),
    type,
    arguments: defaultArguments(type),
  };
  useEditorStore.getState().setChannels((vars) => ({ ...vars, [channelKey(id)]: instance }));
  return instance;
}

/**
 * Apply a partial patch to a channel. Re-strips inactive arguments after
 * the merge, so changing `type` immediately drops fields that are no longer
 * relevant. Top-level fields (label/type) are merged separately from arguments.
 */
export function updateChannel(
  id: string,
  patch: { label?: string; type?: ChannelType; arguments?: Record<string, unknown> },
): void {
  const key = channelKey(id);
  useEditorStore.getState().setChannels((vars) => {
    const existing = vars[key];
    if (!existing) return vars;

    const nextType = patch.type ?? existing.type;
    const mergedArgs = { ...existing.arguments, ...(patch.arguments ?? {}), type: nextType };
    // stripInactiveArguments expects `type` inside the args record so it can
    // evaluate activation rules; we drop it again afterwards since `type` is a
    // top-level field on the instance.
    const stripped = stripInactiveArguments(mergedArgs);
    delete stripped.type;

    // Seed defaults for parameters that became active due to the type change.
    if (patch.type && patch.type !== existing.type) {
      for (const [k, v] of Object.entries(defaultArguments(nextType))) {
        if (stripped[k] === undefined) stripped[k] = v;
      }
    }

    return {
      ...vars,
      [key]: {
        ...existing,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        type: nextType,
        arguments: stripped,
      },
    };
  });
}

export function deleteChannel(id: string): void {
  const key = channelKey(id);
  useEditorStore.getState().setChannels((vars) => {
    const { [key]: _drop, ...rest } = vars;
    return rest;
  });
  if (useEditorStore.getState().selectedChannelId === id) {
    useEditorStore.getState().setSelectedChannelId(null);
  }
}
