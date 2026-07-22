// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Shared vocabulary for the `deploy` command. The workflow requirement analysis
// (Stage 0) lives in @foresthubai/workflow-core/deploy — the language-neutral piece
// the backend path must agree with. The operator-input binding shapes, the spec
// resolver (buildDeploymentSpec) and its validators are CLI-owned (./inputs, ./spec):
// the OSS packaging step, NOT shared with the FE. This module re-exports the whole
// vocabulary so CLI modules import it from one place, and adds the bits that are
// CLI-only: the operator-answer config (DeployConfig), the --values schema, and the
// provider list the CLI takes keys for.

import { z } from "zod";

// The rich requirement vocabulary — CLI-owned OSS packaging (./requirements),
// re-exported so deploy modules pull the whole vocabulary from one place.
export type { DeployRequirements, BoundRequirement, BoundOf, NonCameraHardware, HardwareFamily } from "./requirements";
export { isAddressable, hardwareBindings, cameraBindings, mqttBindings, llmBindings, mlBindings, ragBindings } from "./requirements";
// Operator-input binding shapes + the spec resolver's validators are CLI-owned,
// re-exported so deploy modules pull the whole vocabulary from one place.
export type {
  DeploymentInputs,
  HardwareBinding,
  MqttBinding,
  LLMModelBinding,
  MLModelBinding,
  CameraBinding,
  ProviderBinding,
} from "./inputs";
export {
  ggufNameError,
  mlModelNameError,
  familyMismatches,
  hardwareAddressKey,
  hardwareAddressLabel,
  llamaComponentServiceName,
} from "./spec";

import type { DeployRequirements } from "./requirements";
import { hardwareBindings, cameraBindings, mqttBindings, llmBindings, mlBindings } from "./requirements";

// The providers the wizard can take a key for come from the model catalog (the
// snapshot of the engine's llmproxy). Provider ids are the llmproxy ProviderID
// (capitalized, e.g. "Anthropic") — they flow into `directLlm.provider`.
export { PROVIDER_IDS, providerFlag, providerFromFlag } from "../../src/catalog";

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
    ctxSize: z.number().int().positive().optional(),
  }),
  z.strictObject({ location: z.literal("network"), url: z.string(), apiKey: z.string().optional() }),
]);

// `params` overrides the bundle manifest's params for a device-located model, and
// rides the component's boot config. Not prompted for — a free-form per-model bag is
// only sensibly authored in a --values file. A network model has none: the operator
// runs that component and configures its bundles there.
const mlModelBindingSchema = z.discriminatedUnion("location", [
  z.strictObject({
    location: z.literal("device"),
    model: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  z.strictObject({ location: z.literal("network"), url: z.string(), model: z.string() }),
]);

// A camera is device-owned hardware: it becomes a Resources.cameras entry, not an
// endpoint, so it has no `location` — nothing points at a driver component. The
// kind is the access path (see CameraBinding in inputs.ts), and it picks the
// capture recipe the component owns.
const cameraBindingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("v4l2"),
    device: z.string(),
    warmupFrames: z.number().int().min(0).optional(),
    setup: z.array(z.string()).optional(),
    devices: z.array(z.string()).optional(),
  }),
  z.strictObject({
    kind: z.literal("libcamera"),
    cameraName: z.string().optional(),
    warmupFrames: z.number().int().min(0).optional(),
    setup: z.array(z.string()).optional(),
    devices: z.array(z.string()).optional(),
  }),
  z.strictObject({
    kind: z.literal("rtsp"),
    url: z.string(),
    user: z.string().optional(),
    password: z.string().optional(),
    warmupFrames: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    kind: z.literal("http"),
    url: z.string(),
    user: z.string().optional(),
    password: z.string().optional(),
    warmupFrames: z.number().int().min(0).optional(),
  }),
  z.strictObject({
    kind: z.literal("raw"),
    pipeline: z.string(),
    warmupFrames: z.number().int().min(0).optional(),
    setup: z.array(z.string()).optional(),
    devices: z.array(z.string()).optional(),
  }),
  z.strictObject({ kind: z.literal("debug") }),
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
  check("hardware", hardwareBindings(req).map((c) => c.id), p.hardware);
  check("mqtt", mqttBindings(req).map((c) => c.id), p.mqtt);
  check("model", llmBindings(req).map((m) => m.id), p.llmModels);
  check("model", mlBindings(req).map((m) => m.id), p.mlModels);
  check("camera", cameraBindings(req).map((c) => c.id), p.cameras);
  return unknown;
}

// What the prompts + flags collect from the operator. The hardware/mqtt/
// llmModels/mlModels fields ARE the core DeploymentInputs (structurally), plus
// the CLI-only render knobs (output dir, force, log level) and device-env
// secrets (provider keys, web search) that never enter the spec.
const deployConfigSchema = z.strictObject({
  // provider id (catalog / llmproxy ProviderID) -> API key. Each becomes a
  // `directLlm` provider whose key rides in secrets.json (never the spec, never .env).
  llmKeys: z.record(z.string(), z.string()),
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
  llmKeys: Record<string, string>;
  output?: string;
  logLevel?: string;
  values?: string;
  component: string[];
  force: boolean;
  help: boolean;
}
