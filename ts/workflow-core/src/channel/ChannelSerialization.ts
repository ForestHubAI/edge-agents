import type { Schemas } from "../api";
import { isParameterActive } from "../parameter";
import { CHANNEL_DEFINITION } from "./ChannelDefinition";
import type { ChannelInstance } from "./Channel";

/**
 * Strip arguments belonging to inactive parameters (mirrors NodeSerialization).
 * Used both when writing into the store after a `type` change and when
 * serializing to the API, so the two stay consistent.
 */
export function stripInactiveArguments(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...args };
  for (const param of CHANNEL_DEFINITION.parameters) {
    if (param.activationRules?.length && !isParameterActive(param, args, false)) {
      delete out[param.id];
    }
  }
  return out;
}

/** Every channel variant the editor produces. Same as Schemas["Channel"], aliased for clarity at call sites. */
export type EditorChannelSchema = Schemas["Channel"];

/**
 * Serialize a domain ChannelInstance to the API discriminated-union shape.
 * Deploy-time bindings (`driverId` for hardware, `networkId` for MQTT) are
 * emitted as `""` — the deploy step fills them in against the target device's
 * manifest and network memberships.
 */
export function serialize(ch: ChannelInstance): EditorChannelSchema {
  const { id, label, type } = ch;
  // type-discriminator must be in the args record so stripInactiveArguments
  // can evaluate `parameterIn` activation rules — otherwise every gated field
  // (line/channel/bias/debounceMs/frequency) is stripped as "inactive".
  const args = stripInactiveArguments({ ...ch.arguments, type });
  switch (type) {
    case "GPIOIN":
      return {
        type,
        id,
        label,
        driverId: "",
        line: args.line as number,
        bias: args.bias as Schemas["GPIOINChannel"]["bias"],
        debounceMs: args.debounceMs as number,
      };
    case "GPIOOUT":
      return { type, id, label, driverId: "", line: args.line as number };
    case "ADC":
      return { type, id, label, driverId: "", channel: args.channel as number };
    case "PWM":
      return {
        type,
        id,
        label,
        driverId: "",
        channel: args.channel as number,
        frequency: args.frequency as number,
      };
    case "DAC":
      return { type, id, label, driverId: "", channel: args.channel as number };
    case "UART":
      return { type, id, label, driverId: "" };
    case "MQTT":
      return { type, id, label, networkId: "" };
  }
}

/**
 * Convert an API Channel into a domain ChannelInstance. Deploy-time bindings
 * (`driverId`, `networkId`) are dropped — they aren't part of the editor state.
 */
export function deserialize(api: EditorChannelSchema): ChannelInstance {
  const { id, label, type } = api;
  const args: Record<string, unknown> = {};
  switch (type) {
    case "GPIOIN":
      args.line = api.line;
      args.bias = api.bias;
      args.debounceMs = api.debounceMs;
      break;
    case "GPIOOUT":
      args.line = api.line;
      break;
    case "ADC":
    case "DAC":
      args.channel = api.channel;
      break;
    case "PWM":
      args.channel = api.channel;
      args.frequency = api.frequency;
      break;
    case "UART":
    case "MQTT":
      break;
  }
  return { id, label, type, arguments: args };
}
