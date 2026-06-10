// Shared vocabulary for the `deploy` command: the types every other deploy
// module agrees on, plus the canonical provider list.
//
// The operator-supplied shapes (bindings, DeployConfig) are zod schemas; their
// TS types are inferred from them. One source: the schema validates a --values
// file at runtime, the inferred type checks the code at compile time.

import { z } from "zod";

// Single source of truth for the providers the wizard can take a key for: the
// Provider type, the CLI key flags, and the key prompts all derive from it.
export const ALL_PROVIDERS = ["anthropic", "openai", "gemini", "mistral"] as const;
export type Provider = (typeof ALL_PROVIDERS)[number];

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof logLevelSchema>;

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

// One MQTT channel the workflow declares.
export interface MqttChannel {
  id: string;
  label: string;
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
const hardwareBindingSchema = z.strictObject({
  chipOrDevice: z.string(),
  index: z.number().int().nonnegative().optional(),
  baud: z.number().int().nonnegative().optional(),
});
export type HardwareBinding = z.infer<typeof hardwareBindingSchema>;

// One MQTT channel's connection.
const mqttBindingSchema = z.strictObject({
  brokerUrl: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
});
export type MqttBinding = z.infer<typeof mqttBindingSchema>;

// One custom model's runtime location. `device` = a llama-server sidecar on this
// same controller; `network` = an inference endpoint the operator runs elsewhere.
// The endpoint always serves the model under its workflow id — the engine has no
// upstream-name aliasing yet — so there is no exposed-name field here.
const modelBindingSchema = z.discriminatedUnion("location", [
  z.strictObject({ location: z.literal("device"), modelFile: z.string() }),
  z.strictObject({ location: z.literal("network"), url: z.string(), apiKey: z.string().optional() }),
]);
export type ModelBinding = z.infer<typeof modelBindingSchema>;

// Returns why an on-device model filename is unacceptable, or null when it's
// fine. A name check only — the file doesn't exist yet at wizard time. Shared by
// the prompt and the --values path so both reject the same input.
export function ggufNameError(name: string | undefined): string | null {
  const t = (name ?? "").trim();
  if (!t) return "a model filename is required";
  if (!t.toLowerCase().endsWith(".gguf")) return "must be a .gguf file (llama-server only loads GGUF)";
  if (t.includes("/")) return "just the filename, not a path — the file goes in ./models/";
  return null;
}

// A physical address (GPIO line, ADC/DAC/PWM channel, serial device) belongs to
// exactly one channel — the engine doesn't police this and would silently let
// the last claimer win. Same key = collision; sharing just the path is fine
// (one chip, many lines), except for serial where the path IS the device.
export function hardwareAddressKey(family: HardwareFamily, chipOrDevice: string, index?: number): string {
  const dev = chipOrDevice.trim();
  return family === "serial" ? `serial:${dev}` : `${family}:${dev}:${index}`;
}

// The same address, phrased for error messages: "/dev/gpiochip0 line 17".
export function hardwareAddressLabel(family: HardwareFamily, chipOrDevice: string, index?: number): string {
  const dev = chipOrDevice.trim();
  if (family === "serial") return dev;
  return `${dev} ${family === "gpio" ? "line" : "channel"} ${index}`;
}

// One message per channel whose address an earlier channel already claimed.
// Incomplete bindings are skipped (completeness is a separate check). Shared by
// the deploy guard and the --values fail-fast path so both report identically.
export function hardwareConflicts(channels: HardwareChannel[], bindings: Record<string, HardwareBinding>): string[] {
  const conflicts: string[] = [];
  const claimed = new Map<string, string>(); // address key -> channel id holding it
  for (const ch of channels) {
    const b = bindings[ch.id];
    if (!b?.chipOrDevice || (ch.addressable && b.index === undefined)) continue;
    const key = hardwareAddressKey(ch.family, b.chipOrDevice, b.index);
    const holder = claimed.get(key);
    if (holder) {
      conflicts.push(`hardware "${ch.id}": ${hardwareAddressLabel(ch.family, b.chipOrDevice, b.index)} is already used by "${holder}"`);
    } else {
      claimed.set(key, ch.id);
    }
  }
  return conflicts;
}

// One message per binding carrying a field its family doesn't have (`baud` is
// serial-only, `index` is everything-but-serial). Usually a mixed-up channel id
// in a machine-written --values file — reject loudly instead of ignoring.
export function familyMismatches(channels: HardwareChannel[], bindings: Record<string, HardwareBinding>): string[] {
  const mismatches: string[] = [];
  for (const ch of channels) {
    const b = bindings[ch.id];
    if (!b) continue;
    if (ch.family !== "serial" && b.baud !== undefined) {
      mismatches.push(`hardware "${ch.id}": "baud" only applies to serial channels (this is a ${ch.family} channel)`);
    }
    if (ch.family === "serial" && b.index !== undefined) {
      mismatches.push(`hardware "${ch.id}": "index" does not apply to serial channels (the device path is the full address)`);
    }
  }
  return mismatches;
}

// One message per binding whose id the workflow doesn't declare — usually a
// typo'd channel/model id in a machine-written --values file. The builders only
// iterate the workflow's ids, so a stray entry would otherwise vanish silently.
export function unknownIds(req: DeployRequirements, p: Partial<DeployConfig>): string[] {
  const unknown: string[] = [];
  const check = (kind: string, ids: string[], bindings: Record<string, unknown> | undefined): void => {
    const known = new Set(ids);
    for (const id of Object.keys(bindings ?? {})) {
      if (!known.has(id)) unknown.push(`${kind} "${id}": the workflow declares no such ${kind === "model" ? "model" : "channel"}`);
    }
  };
  check("hardware", req.hardwareChannels.map((c) => c.id), p.hardware);
  check("mqtt", req.mqttChannels.map((c) => c.id), p.mqtt);
  check("model", req.customModels.map((m) => m.id), p.models);
  return unknown;
}

// Web-search provider + key. Engine-wide, so just one.
const webSearchBindingSchema = z.strictObject({
  provider: z.string(),
  apiKey: z.string(),
});
export type WebSearchBinding = z.infer<typeof webSearchBindingSchema>;

// What the prompts + flags collect from the operator. Drives all generators
// (composeYaml / envFile / readme) and the output writer. hardware/mqtt/models
// are keyed by workflow logical id (channel-id / model-id) and empty when the
// workflow declares none of that kind.
const deployConfigSchema = z.strictObject({
  llmKeys: z.partialRecord(z.enum(ALL_PROVIDERS), z.string()),
  outputDir: z.string(),
  force: z.boolean(),
  logLevel: logLevelSchema,
  hardware: z.record(z.string(), hardwareBindingSchema),
  mqtt: z.record(z.string(), mqttBindingSchema),
  models: z.record(z.string(), modelBindingSchema),
  webSearch: webSearchBindingSchema.optional(),
});
export type DeployConfig = z.infer<typeof deployConfigSchema>;

// The --values file shape: DeployConfig with every field optional. Derived via
// .partial(), so it can never drift from DeployConfig itself. Still strict — an
// unknown key (a typo) is an error, not silently ignored.
export const valuesFileSchema = deployConfigSchema.partial();

// The raw, still-unvalidated flag values straight off the command line.
export interface RawFlags {
  llmKeys: Partial<Record<Provider, string>>;
  output?: string;
  logLevel?: string;
  values?: string;
  force: boolean;
  help: boolean;
}
