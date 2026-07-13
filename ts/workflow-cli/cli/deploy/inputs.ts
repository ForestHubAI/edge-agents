// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Operator-supplied bindings: the per-deploy VALUES that bind a workflow's logical
// resource ids to a concrete environment, for the OSS CLI deploy path. The operator
// types concrete values here (device paths, broker URLs, model files); the resolver
// (buildDeploymentSpec) maps them into a DeploymentSpec.
//
// CLI-only — NOT shared with the backend/FE path. That path collects resource
// REFERENCES (driverId/networkId) chosen from queried device/account state and folds
// them into a ResourceBindingRequest the backend resolves against its DB. Values vs
// references: two different shapes, one per renderer. The only thing both paths share
// is the Stage-0 binding SURFACE (workflow-core's workflowBindingRequirements).
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

// One custom LLM model's runtime location. `device` = served by the shared
// llama-server component on this controller (llama-swap fronts every on-device model,
// the engine selecting one by id per request); `network` = an inference endpoint the
// operator runs elsewhere. The endpoint serves the model under its workflow id — no
// upstream-name aliasing yet.
export type LLMModelBinding =
  | { location: "device"; modelFile: string; ctxSize?: number }
  | { location: "network"; url: string; apiKey?: string };

// One custom ML model's runtime location. `device` = served by the shared
// inference component on this controller (the model repository is a directory the
// operator fills); `network` = an inference endpoint the operator runs
// elsewhere. Credential-free — a trusted endpoint. `model` = the name the
// component selects on (its repository sub-folder on device).
export type MLModelBinding =
  | { location: "device"; model: string }
  | { location: "network"; url: string; model: string };

// One camera channel's runtime location. `device` = read by the shared capture
// component on this controller from a local capture source (`v4l2` wraps a
// /dev/video* path; `gstreamer` takes a source element verbatim, e.g.
// libcamerasrc); `network` = a capture endpoint the operator runs elsewhere.
// Credential-free — a trusted endpoint. `warmupFrames` discards that many leading
// frames so a sensor's auto-exposure can settle before the returned one.
// `setup` = shell commands (media-ctl/v4l2-ctl) the component replays on every
// container start, for statically configured CSI/ISP pipelines; `devices` = the
// extra device nodes those commands touch, passed through to the container.
export type CameraBinding =
  | {
      location: "device";
      source: "v4l2" | "gstreamer";
      device: string;
      warmupFrames?: number;
      setup?: string[];
      devices?: string[];
    }
  | { location: "network"; url: string };

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
  llmModels: Record<string, LLMModelBinding>;
  mlModels: Record<string, MLModelBinding>;
  cameras: Record<string, CameraBinding>;
  providers?: Record<string, ProviderBinding>;
}
