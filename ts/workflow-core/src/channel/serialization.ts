// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

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
 * field (bias/debounceMs/frequency) is stripped as "inactive". Physical
 * addressing (GPIO line, ADC/PWM/DAC channel) is not here — it's a deploy
 * binding, not workflow state.
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
        bias: args.bias as Schemas["GPIOINChannel"]["bias"],
        debounceMs: args.debounceMs as number,
      };
    case "GPIOOUT":
      return { type, id, label };
    case "ADC":
      return { type, id, label };
    case "PWM":
      return { type, id, label, frequency: args.frequency as number };
    case "DAC":
      return { type, id, label };
    case "UART":
      return { type, id, label };
    case "MQTT":
      return { type, id, label, topic: args.topic as string };
    case "LOG":
      return { type, id, label, level: args.level as Schemas["LOGChannel"]["level"], tag: args.tag as string | undefined };
    case "CAMERA":
      return { type, id, label, width: args.width as number | undefined, height: args.height as number | undefined };
  }
}

/** Convert an API Channel into a domain Channel. */
export function deserialize(api: ApiChannel): Channel {
  const { id, label, type } = api;
  const args: Record<string, unknown> = {};
  switch (type) {
    case "GPIOIN":
      args.bias = api.bias;
      args.debounceMs = api.debounceMs;
      break;
    case "PWM":
      args.frequency = api.frequency;
      break;
    case "MQTT":
      args.topic = api.topic;
      break;
    case "LOG":
      args.level = api.level;
      args.tag = api.tag;
      break;
    case "CAMERA":
      args.width = api.width;
      args.height = api.height;
      break;
    case "GPIOOUT":
    case "ADC":
    case "DAC":
    case "UART":
      break;
  }
  return { id, label, type, arguments: args };
}
