// Shared vocabulary for the `deploy` command. The resolution logic — requirement
// derivation, the binding shapes, the spec resolver and its validators — lives in
// @foresthubai/workflow-core/deploy (shared with the FE). This module re-exports
// that vocabulary so CLI modules import it from one place, and adds the bits that
// are CLI-only: the operator-answer config (DeployConfig), the --values schema,
// and the provider list the CLI takes keys for.

import { z } from "zod";

// The shared deploy vocabulary, re-exported from core.
export type {
  DeployRequirements,
  HardwareChannel,
  MqttChannel,
  CameraChannel,
  CustomLLMModel,
  CustomMLModel,
  HardwareFamily,
  HardwareBinding,
  MqttBinding,
  LLMModelBinding,
  MLModelBinding,
  CameraBinding,
} from "@foresthubai/workflow-core/deploy";
export {
  ggufNameError,
  mlModelNameError,
  hardwareConflicts,
  familyMismatches,
  hardwareAddressKey,
  hardwareAddressLabel,
  llmSidecarServiceName,
} from "@foresthubai/workflow-core/deploy";

import type { DeployRequirements } from "@foresthubai/workflow-core/deploy";

// Single source of truth for the providers the wizard can take a key for: the
// Provider type, the CLI key flags, and the key prompts all derive from it.
export const ALL_PROVIDERS = ["anthropic", "openai", "gemini", "mistral"] as const;
export type Provider = (typeof ALL_PROVIDERS)[number];

export const logLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof logLevelSchema>;

// Zod mirrors of the core binding shapes, used only to validate a --values file
// at runtime. Their inferred types are structurally identical to core's binding
// interfaces, so a parsed DeployConfig flows straight into buildDeploymentSpec.
const hardwareBindingSchema = z.strictObject({
  chipOrDevice: z.string(),
  index: z.number().int().nonnegative().optional(),
  baud: z.number().int().nonnegative().optional(),
});

const mqttBindingSchema = z.strictObject({
  brokerUrl: z.string(),
  username: z.string().optional(),
  password: z.string().optional(),
});

const llmModelBindingSchema = z.discriminatedUnion("location", [
  z.strictObject({
    location: z.literal("device"),
    modelFile: z.string(),
    port: z.number().int().positive().optional(),
    ctxSize: z.number().int().positive().optional(),
  }),
  z.strictObject({ location: z.literal("network"), url: z.string(), apiKey: z.string().optional() }),
]);

const mlModelBindingSchema = z.discriminatedUnion("location", [
  z.strictObject({ location: z.literal("device"), model: z.string() }),
  z.strictObject({ location: z.literal("network"), url: z.string(), model: z.string() }),
]);

const cameraBindingSchema = z.discriminatedUnion("location", [
  z.strictObject({
    location: z.literal("device"),
    source: z.enum(["v4l2", "gstreamer"]),
    device: z.string(),
    warmupFrames: z.number().int().min(0).optional(),
    setup: z.array(z.string()).optional(),
    devices: z.array(z.string()).optional(),
  }),
  z.strictObject({ location: z.literal("network"), url: z.string() }),
]);

// Web-search provider + key. Engine-wide, so just one. Device env, never in the
// spec — collected here only so the CLI can write it to .env.
const webSearchBindingSchema = z.strictObject({
  provider: z.string(),
  apiKey: z.string(),
});
export type WebSearchBinding = z.infer<typeof webSearchBindingSchema>;

// One message per binding whose id the workflow doesn't declare — usually a
// typo'd channel/model id in a machine-written --values file. The resolver only
// iterates the workflow's ids, so a stray entry would otherwise vanish silently.
// A CLI-only concern (a typed FE form can't produce stray ids), so it stays here.
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
  check("model", req.customLLMModels.map((m) => m.id), p.llmModels);
  check("model", req.customMLModels.map((m) => m.id), p.mlModels);
  check("camera", req.cameraChannels.map((c) => c.id), p.cameras);
  return unknown;
}

// What the prompts + flags collect from the operator. The hardware/mqtt/
// llmModels/mlModels fields ARE the core DeploymentInputs (structurally), plus
// the CLI-only render knobs (output dir, force, log level) and device-env
// secrets (provider keys, web search) that never enter the spec.
const deployConfigSchema = z.strictObject({
  llmKeys: z.partialRecord(z.enum(ALL_PROVIDERS), z.string()),
  outputDir: z.string(),
  force: z.boolean(),
  logLevel: logLevelSchema,
  hardware: z.record(z.string(), hardwareBindingSchema),
  mqtt: z.record(z.string(), mqttBindingSchema),
  llmModels: z.record(z.string(), llmModelBindingSchema),
  mlModels: z.record(z.string(), mlModelBindingSchema),
  cameras: z.record(z.string(), cameraBindingSchema),
  webSearch: webSearchBindingSchema.optional(),
});
export type DeployConfig = z.infer<typeof deployConfigSchema>;

// The --values file shape: DeployConfig with every field optional. Derived via
// .partial(), so it can never drift from DeployConfig. Still strict — an unknown
// key (a typo) is an error, not silently ignored.
export const valuesFileSchema = deployConfigSchema.partial();

// The raw, still-unvalidated flag values straight off the command line.
export interface RawFlags {
  llmKeys: Partial<Record<Provider, string>>;
  output?: string;
  logLevel?: string;
  values?: string;
  component: string[];
  force: boolean;
  help: boolean;
}
