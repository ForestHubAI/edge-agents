// Operator-supplied bindings: the per-deploy values that bind a workflow's
// logical resource ids to a concrete environment. Shared by every spec
// producer (the CLI prompts/--values, the FE deploy forms) — how the values are
// collected differs per renderer, but the shape they resolve to is one thing.
//
// Secrets policy: provider API keys and the web-search key are NOT here — they
// are device/operator-scoped engine env, injected at render time, never frozen
// into a versioned spec. Only deployment-scoped resource creds (broker, custom
// endpoint) live in these bindings, because EngineConfig.externalResources needs
// them resolved inline.

// One hardware channel's physical address. `index` = sub-address (addressable
// families: GPIO line, ADC/DAC/PWM channel); `baud` = serial only; `source` =
// camera only (which engine capture source runs).
export interface HardwareBinding {
  chipOrDevice: string;
  index?: number;
  baud?: number;
  source?: "v4l2" | "gstreamer";
}

// One MQTT channel's broker connection.
export interface MqttBinding {
  brokerUrl: string;
  username?: string;
  password?: string;
}

// One custom model's runtime location. `device` = a llama-server sidecar on this
// controller (the engine reaches it over the container network by service name);
// `network` = an inference endpoint the operator runs elsewhere. The endpoint
// serves the model under its workflow id — no upstream-name aliasing yet.
export type ModelBinding =
  | { location: "device"; modelFile: string; port?: number; ctxSize?: number }
  | { location: "network"; url: string; apiKey?: string };

// The complete set of bindings a deploy supplies, keyed by workflow logical id
// (channel id / model id). Empty for any resource kind the workflow doesn't use.
export interface DeploymentInputs {
  hardware: Record<string, HardwareBinding>;
  mqtt: Record<string, MqttBinding>;
  models: Record<string, ModelBinding>;
}
