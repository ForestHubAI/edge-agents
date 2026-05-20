import type { Parameter } from "../parameter";
import { ALL_CHANNEL_TYPES } from "./Channel";

/**
 * Single union definition for all Channel variants. Variant-specific
 * parameters are gated by activation rules on the `type` discriminator.
 */
export interface ChannelDefinition {
  parameters: Parameter[];
}

export const CHANNEL_DEFINITION: ChannelDefinition = {
  parameters: [
    {
      id: "type",
      label: "Type",
      description: "Channel type",
      type: "selection",
      default: "GPIOIN",
      options: ALL_CHANNEL_TYPES.map((t) => ({ value: t, label: t })),
    },
    {
      id: "line",
      label: "Line",
      description: "GPIO line number",
      type: "int",
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["GPIOIN", "GPIOOUT"] }],
    },
    {
      id: "channel",
      label: "Channel",
      description: "Channel number",
      type: "int",
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["ADC", "PWM", "DAC"] }],
    },
    {
      id: "bias",
      label: "Bias",
      description: "Pin bias configuration",
      type: "selection",
      default: "none",
      options: [
        { value: "none", label: "None" },
        { value: "pullup", label: "Pull-up" },
        { value: "pulldown", label: "Pull-down" },
      ],
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["GPIOIN"] }],
    },
    {
      id: "debounceMs",
      label: "Debounce (ms)",
      description: "Debounce window in milliseconds",
      type: "int",
      default: 50,
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["GPIOIN"] }],
    },
    {
      id: "frequency",
      label: "Frequency (Hz)",
      description: "PWM frequency in Hz",
      type: "int",
      default: 1000,
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["PWM"] }],
    },
  ],
};
