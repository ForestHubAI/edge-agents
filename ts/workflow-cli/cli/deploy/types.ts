// Shared vocabulary for the `deploy` command: the types every other deploy
// module agrees on, plus the canonical provider list.

export type Provider = "anthropic" | "openai" | "gemini" | "mistral";

export const ALL_PROVIDERS: Provider[] = ["anthropic", "openai", "gemini", "mistral"];

export type LogLevel = "debug" | "info" | "warn" | "error";

// The five hardware-channel families the engine has a driver for. UART is the
// odd one out: it carries no per-channel sub-address (see `addressable`).
export type HardwareFamily = "gpio" | "adc" | "dac" | "pwm" | "serial";

// One hardware channel the workflow declares. The Inspector derives `family`
// from the channel's wire `type`; `addressable` is false only for serial/UART
// (every gpio/adc/dac/pwm channel needs an `index` sub-address, UART does not).
export interface HardwareChannel {
  id: string;
  label: string;
  family: HardwareFamily;
  addressable: boolean;
}

// One MQTT channel the workflow declares. `topic` is the workflow-level topic;
// the broker prefix is applied by the engine at runtime.
export interface MqttChannel {
  id: string;
  label: string;
  topic: string;
}

// One custom/self-hosted model declared in workflow.models — needs an
// ExternalResources provider entry: a sidecar this bundle runs (device) or an
// endpoint the operator runs elsewhere (network).
export interface CustomModel {
  id: string;
  label: string;
}

// What the Inspector derives from the workflow content alone. Pure-functional
// output — no file paths, no operator input.
export interface DeployRequirements {
  // True when at least one Agent references a model NOT declared in
  // workflow.models — a catalog model that needs a provider API key. The key
  // must be present in .env or the Agent node fails at build.
  hasProviderModel: boolean;
  // True when the workflow has a Retriever node. A standalone engine has no
  // retriever, so the node cannot resolve and the engine fails at build.
  hasRetriever: boolean;
  // Every hardware channel the workflow declares, in declaration order. Drives
  // device_manifest.json + the deployment mapping + compose device-passthrough.
  hardwareChannels: HardwareChannel[];
  // Every MQTT channel — each becomes an ExternalResources entry + a mapping.
  mqttChannels: MqttChannel[];
  // Every custom model — each becomes an ExternalResources provider + a mapping.
  customModels: CustomModel[];
  // True when any node is a WebSearchTool — needs ENGINE_WEB_SEARCH_API_KEY.
  hasWebSearch: boolean;
}

// One hardware channel's physical value. `index` = sub-address (addressable
// families only); `baud` = serial only.
export interface HardwareBinding {
  chipOrDevice: string;
  index?: number;
  baud?: number;
}

// One MQTT channel's connection.
export interface MqttBinding {
  brokerUrl: string;
  username?: string;
  password?: string;
  publishPrefix?: string;
  subscribePrefix?: string;
}

// One custom model's runtime location. `device` = a llama-server sidecar on this
// same controller; `network` = an inference endpoint the operator runs elsewhere.
// The endpoint always serves the model under its workflow id — the engine has no
// upstream-name aliasing yet — so there is no exposed-name field here.
export type ModelBinding =
  | { location: "device"; modelFile: string }
  | { location: "network"; url: string; apiKey?: string };

// Web-search provider + key. Engine-wide, so just one.
export interface WebSearchBinding {
  provider: string;
  apiKey: string;
}

// What the prompts + flags collect from the operator. Drives all generators
// (composeYaml / envFile / readme) and the output writer.
export interface DeployConfig {
  llmKeys: Partial<Record<Provider, string>>;
  outputDir: string;
  force: boolean;
  logLevel: LogLevel;
  // Physical values per requirement, keyed by workflow logical id (channel-id /
  // model-id). Empty when the workflow declares none of that kind.
  hardware: Record<string, HardwareBinding>;
  mqtt: Record<string, MqttBinding>;
  models: Record<string, ModelBinding>;
  webSearch?: WebSearchBinding;
}

// The raw, still-unvalidated flag values straight off the command line.
export interface RawFlags {
  anthropicKey?: string;
  openaiKey?: string;
  geminiKey?: string;
  mistralKey?: string;
  output?: string;
  logLevel?: string;
  values?: string;
  force: boolean;
  help: boolean;
}
