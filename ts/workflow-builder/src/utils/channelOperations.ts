import { CHANNEL_DEFINITION, type ChannelType, type Channel } from "@foresthubai/workflow-core/channel";
import { isParameterActive } from "@foresthubai/workflow-core/parameter";
import { useEditorStore } from "../stores/editorStore";
import { generateId } from "@foresthubai/workflow-core/id";
import { uniqueName } from "./resourceHelpers";

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

/**
 * Create a new channel in the editor store. Returns the new instance.
 */
export function addChannel(type: ChannelType = "GPIOIN"): Channel {
  const id = generateId();
  const existing = Object.values(useEditorStore.getState().channels).map((v) => v.label);
  const instance: Channel = {
    id,
    label: uniqueName("channel", existing),
    type,
    arguments: defaultArguments(type),
  };
  useEditorStore.getState().setChannels((vars) => ({ ...vars, [id]: instance }));
  return instance;
}

/**
 * Apply a partial patch to a channel. Inactive arguments are intentionally
 * retained in the store: the domain store is the superset and stripping happens
 * only at the api boundary (`serialize`), so switching `type` away and back
 * restores previously-entered values rather than resetting them. On a type
 * change we still seed defaults for params that are newly active and unset, so
 * the config panel shows sensible initial values. Top-level fields (label/type)
 * are merged separately from arguments.
 */
export function updateChannel(id: string, patch: { label?: string; type?: ChannelType; arguments?: Record<string, unknown> }): void {
  const key = id;
  useEditorStore.getState().setChannels((vars) => {
    const existing = vars[key];
    if (!existing) return vars;

    const nextType = patch.type ?? existing.type;
    const mergedArgs = { ...existing.arguments, ...(patch.arguments ?? {}) };

    if (patch.type && patch.type !== existing.type) {
      for (const [k, v] of Object.entries(defaultArguments(nextType))) {
        if (mergedArgs[k] === undefined) mergedArgs[k] = v;
      }
    }

    return {
      ...vars,
      [key]: {
        ...existing,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        type: nextType,
        arguments: mergedArgs,
      },
    };
  });
}

export function deleteChannel(id: string): void {
  const key = id;
  useEditorStore.getState().setChannels((vars) => {
    const { [key]: _drop, ...rest } = vars;
    return rest;
  });
  if (useEditorStore.getState().selectedChannelId === id) {
    useEditorStore.getState().setSelectedChannelId(null);
  }
}
