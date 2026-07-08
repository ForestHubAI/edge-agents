// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// Operator-supplied bindings: the per-deploy values that bind a workflow's
// logical resource ids to a concrete environment. Shared by every spec
// producer (the CLI prompts/--values, the FE deploy forms) — how the values are
// collected differs per renderer, but the shape they resolve to is one thing.
//
// Secrets policy: the web-search key is NOT here — it is device/operator-scoped
// engine env, injected at render time, never frozen into a versioned spec.
// Deployment-scoped resource creds (broker password, custom-endpoint bearer,
// catalog providerKey API key) DO live here: they resolve into
// EngineConfig.externalResources' refs and their secret values are pulled out
// into secrets.json — never into the versioned spec itself.

// One hardware channel's physical address. `index` = sub-address (addressable
// families: GPIO line, ADC/DAC/PWM channel); `baud` = serial only.
export interface HardwareBinding {
  chipOrDevice: string;
  index?: number;
  baud?: number;
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

// One catalog provider's routing, keyed by provider id. `local` = the engine's
// built-in adapter serves it with a deploy-delivered API key (pulled into
// secrets.json, keyed by the resolved resource ref); `backend` = the engine
// proxies this provider through the backend and holds no key.
export type ProviderBinding = { routing: "local"; apiKey?: string } | { routing: "backend" };

// The complete set of bindings a deploy supplies, keyed by workflow logical id
// (channel id / model id / provider id). Empty for any resource kind the
// workflow doesn't use. `providers` is optional: absent leaves catalog providers
// unbound (a gap assertDeployable reports only when the workflow needs them).
export interface DeploymentInputs {
  hardware: Record<string, HardwareBinding>;
  mqtt: Record<string, MqttBinding>;
  models: Record<string, ModelBinding>;
  providers?: Record<string, ProviderBinding>;
}
