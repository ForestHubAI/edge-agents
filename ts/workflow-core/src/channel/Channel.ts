// Domain Channel — device-independent, used in the editor and saved with
// the project. The API schema's Channel carries deploy-time bindings the
// editor never sets directly: `driverId` for hardware channels (GPIO/UART/…)
// is bound against the target device's manifest, and `networkId` for MQTT
// channels is bound against the device's network memberships. Both are
// emitted as `""` on serialize and stripped on deserialize.

export type ChannelType = "GPIOIN" | "GPIOOUT" | "ADC" | "PWM" | "DAC" | "UART" | "MQTT";

export const ALL_CHANNEL_TYPES: ChannelType[] = ["GPIOIN", "GPIOOUT", "ADC", "PWM", "DAC", "UART", "MQTT"];

export interface ChannelInstance {
  id: string;
  label: string;
  type: ChannelType;
  arguments: Record<string, unknown>;
}
