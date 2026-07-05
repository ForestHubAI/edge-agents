// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

export type ChannelType = "GPIOIN" | "GPIOOUT" | "ADC" | "PWM" | "DAC" | "UART" | "MQTT" | "LOG";

export const ALL_CHANNEL_TYPES: ChannelType[] = ["GPIOIN", "GPIOOUT", "ADC", "PWM", "DAC", "UART", "MQTT", "LOG"];

/** Interface for a channel instance in the workflow */
export interface Channel {
  id: string;
  label: string;
  type: ChannelType;
  arguments: Record<string, unknown>;
}
