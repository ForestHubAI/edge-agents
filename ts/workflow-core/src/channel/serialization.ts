import type { Schemas } from "../api";
import { pruneArguments } from "../parameter";
import { CHANNEL_DEFINITION } from "./ChannelDefinition";
import type { Channel } from "./Channel";

export type ApiChannel = Schemas["Channel"];

/**
 * Serialize a domain Channel to the API discriminated-union shape.
 *
 * The domain store retains inactive parameters (non-destructive type switching),
 * so this is the boundary that drops them. The `type` discriminator must be in
 * the args record so `parameterIn` rules can evaluate — otherwise every gated
 * field (line/channel/bias/debounceMs/frequency) is stripped as "inactive".
 */
export function serialize(ch: Channel): ApiChannel {
  const { id, label, type } = ch;
  const args: Record<string, unknown> = { ...ch.arguments, type };
  pruneArguments(args, CHANNEL_DEFINITION.parameters);
  switch (type) {
    case "GPIOIN":
      return {
        type,
        id,
        label,
        line: args.line as number,
        bias: args.bias as Schemas["GPIOINChannel"]["bias"],
        debounceMs: args.debounceMs as number,
      };
    case "GPIOOUT":
      return { type, id, label, line: args.line as number };
    case "ADC":
      return { type, id, label, channel: args.channel as number };
    case "PWM":
      return {
        type,
        id,
        label,
        channel: args.channel as number,
        frequency: args.frequency as number,
      };
    case "DAC":
      return { type, id, label, channel: args.channel as number };
    case "UART":
      return { type, id, label };
    case "MQTT":
      return { type, id, label };
  }
}

/** Convert an API Channel into a domain Channel. */
export function deserialize(api: ApiChannel): Channel {
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
