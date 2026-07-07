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

// One custom LLM model's runtime location. `device` = a llama-server sidecar on
// this controller (the engine reaches it over the container network by service
// name); `network` = an inference endpoint the operator runs elsewhere. The
// endpoint serves the model under its workflow id — no upstream-name aliasing yet.
export type LLMModelBinding =
  | { location: "device"; modelFile: string; port?: number; ctxSize?: number }
  | { location: "network"; url: string; apiKey?: string };

// One custom ML model's runtime location. `device` = served by the shared
// inference sidecar on this controller (no per-model settings — the model
// repository is a directory the operator fills); `network` = an inference
// endpoint the operator runs elsewhere. Credential-free — a trusted endpoint.
export type MLModelBinding = { location: "device" } | { location: "network"; url: string };

// One camera channel's runtime location. `device` = read by the shared capture
// sidecar on this controller from a local capture source (`v4l2` wraps a
// /dev/video* path; `gstreamer` takes a source element verbatim, e.g.
// libcamerasrc); `network` = a capture endpoint the operator runs elsewhere.
// Credential-free — a trusted endpoint. `warmupFrames` discards that many leading
// frames so a sensor's auto-exposure can settle before the returned one.
// `setup` = shell commands (media-ctl/v4l2-ctl) the sidecar replays on every
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

// The complete set of bindings a deploy supplies, keyed by workflow logical id
// (channel id / model id). Empty for any resource kind the workflow doesn't use.
export interface DeploymentInputs {
  hardware: Record<string, HardwareBinding>;
  mqtt: Record<string, MqttBinding>;
  llmModels: Record<string, LLMModelBinding>;
  mlModels: Record<string, MLModelBinding>;
  cameras: Record<string, CameraBinding>;
}
