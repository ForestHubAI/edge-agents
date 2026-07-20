// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// The OSS CLI's enrichment of the Stage-0 binding surface. workflowBindingRequirements
// (in @foresthubai/workflow-core/deploy) is the single, cross-language authority for
// WHAT a workflow needs bound — an id->kind surface the backend produces identically.
// This layer does NOT re-decide that set: it iterates the surface and enriches each
// entry into the typed pools the OSS deploy artifacts and prompts need — hardware
// family/addressability, the LLM-vs-ML split, catalog-model→provider resolution.
// That is exactly the pattern the FE follows off the same surface (there, enriching
// each binding against DB state to build a form). Same root, per-consumer HOW.
//
// NOT a cross-language seam itself — the backend builds its own enrichment off the
// surface. CLI-owned OSS packaging (Stage-1 input prep).

import type { Workflow } from "@foresthubai/workflow-core/workflow";
import type { Channel } from "@foresthubai/workflow-core/channel";
import type { Model, ModelInfo } from "@foresthubai/workflow-core/model";
import type { Memory } from "@foresthubai/workflow-core/memory";
import { workflowBindingRequirements, type Requirement } from "@foresthubai/workflow-core/deploy";

// The five hardware-channel families the engine has a driver for. UART is the
// odd one out: it carries no per-channel sub-address (see `addressable`).
export type HardwareFamily = "gpio" | "adc" | "dac" | "pwm" | "serial";

// One hardware channel the workflow declares. `family` is derived from the
// channel type; `addressable` is false only for serial/UART (every
// gpio/adc/dac/pwm channel needs an `index` sub-address, UART does not).
export interface HardwareChannel {
  id: string;
  label: string;
  family: HardwareFamily;
  addressable: boolean;
}

export interface MqttChannel {
  id: string;
  label: string;
}

// One camera channel the workflow declares — needs a DeviceManifest camera entry
// + a mapping. Camera is device-owned hardware: nothing in ExternalResources may
// point at its driver component, which the engine issues at a constant address.
export interface CameraChannel {
  id: string;
  label: string;
}

// One custom/self-hosted LLM model declared in workflow.models — needs an
// ExternalResources provider entry (a device component or a network endpoint).
export interface CustomLLMModel {
  id: string;
  label: string;
}

// One custom ML model declared in workflow.models — served by an inference
// component (on-device or a network endpoint), selected by id.
export interface CustomMLModel {
  id: string;
  label: string;
}

// One declared VectorDatabase — needs a retrieval collection bound. A standalone
// engine has no retriever backing, so OSS can bind none of these; the pool exists
// to refuse the deploy (see assertDeployable), not to enrich.
export interface RagMemory {
  id: string;
  label: string;
}

// One catalog provider a workflow's Agent nodes pull models from (resolved
// against the static catalog, not workflow.models). Each becomes one
// ExternalResources entry whose routing — local key vs backend — is a deploy input.
export interface CatalogProvider {
  id: string;
}

// What a workflow needs from its environment, derived from its content alone —
// no operator input. Drives both input collection (which bindings to ask for)
// and the spec resolver's completeness check. The component-set derivation the
// migration doc names as must-not-be-duplicated lives here, shared by every
// producer.
export interface DeployRequirements {
  // At least one Agent references a catalog model (not declared in
  // workflow.models). Catalog-independent — a raw signal that provider
  // credentials are needed, even headlessly where the provider set is unknown.
  hasProviderModel: boolean;
  // Distinct catalog providers the referenced models resolve to, via the
  // supplied catalog. Each becomes one ExternalResources provider instance
  // (local or backend — a deploy input). Catalog models carry NO mapping entry:
  // the engine's single llmproxy routes them by model id, so the provider
  // instance's presence is what selects local vs backend. Empty when no catalog
  // is passed — the model->provider map is then unknown.
  catalogProviders: CatalogProvider[];
  // Referenced catalog model ids absent from the supplied catalog — a dangling
  // ref the resolver refuses to deploy. Always empty when no catalog is passed.
  unresolvedCatalogModels: string[];
  // Every declared VectorDatabase. A standalone engine has no retriever, so none
  // can be bound and the engine fatals resolving them — a producer refuses to
  // deploy on a non-empty pool.
  ragMemories: RagMemory[];
  // The workflow has a WebSearchTool node — needs a web-search key as engine env.
  hasWebSearch: boolean;
  // Every hardware channel, in declaration order; drives the device manifest +
  // mapping + container device passthrough.
  hardwareChannels: HardwareChannel[];
  // Every MQTT channel; each becomes an ExternalResources entry + a mapping.
  mqttChannels: MqttChannel[];
  // Every camera channel; each becomes a DeviceManifest entry + a mapping (and a
  // share of the one driver component the engine issues for the whole set).
  cameraChannels: CameraChannel[];
  // Every declared custom LLM model; each becomes an ExternalResources provider
  // + a mapping (and a llama-server component when bound on-device).
  customLLMModels: CustomLLMModel[];
  // Every declared custom ML model; each becomes an ExternalResources entry + a
  // mapping (and a share of the inference component when bound on-device).
  customMLModels: CustomMLModel[];
}

// Drift sentinel: a new Requirement kind breaks compilation here until it is
// enriched into a pool below. Keeps this enrichment layer honest with the Stage-0
// surface.
function assertNeverKind(k: never): never {
  throw new Error(`unhandled binding kind: ${String(k)}`);
}

// The surface classifies an id as "hardware"; the family (which driver, and
// whether it carries a sub-address) is the enrichment detail, read back off the
// channel here. Unreachable default: the surface only tags the six families below.
function hardwareChannelOf(ch: Channel): HardwareChannel {
  switch (ch.type) {
    case "GPIOIN":
    case "GPIOOUT":
      return { id: ch.id, label: ch.label, family: "gpio", addressable: true };
    case "ADC":
      return { id: ch.id, label: ch.label, family: "adc", addressable: true };
    case "DAC":
      return { id: ch.id, label: ch.label, family: "dac", addressable: true };
    case "PWM":
      return { id: ch.id, label: ch.label, family: "pwm", addressable: true };
    case "UART":
      return { id: ch.id, label: ch.label, family: "serial", addressable: false };
    default:
      throw new Error(`binding surface tagged "${ch.id}" (${ch.type}) as hardware, but it is not a hardware family`);
  }
}

// The surface keys hardware/mqtt/camera ids from workflow.channels and declared-
// model ids from workflow.models, so these lookups always hit; the throws document
// that invariant for the type checker (and catch a surface that ever drifts).
function requireChannel(workflow: Workflow, id: string): Channel {
  const ch = workflow.channels[id];
  if (!ch) throw new Error(`binding surface referenced unknown channel "${id}"`);
  return ch;
}
function requireModel(workflow: Workflow, id: string): Model {
  const m = workflow.models[id];
  if (!m) throw new Error(`binding surface referenced unknown model "${id}"`);
  return m;
}
function requireMemory(workflow: Workflow, id: string): Memory {
  const m = workflow.memory[id];
  if (!m) throw new Error(`binding surface referenced unknown memory "${id}"`);
  return m;
}

// deriveRequirements enriches the Stage-0 binding surface
// (workflowBindingRequirements) into the typed pools the OSS deploy artifacts and
// prompts need. Pure — no I/O, no operator input. The surface is the single
// authority for WHAT needs binding, cross-language with the backend; this layer
// only adds the OSS-specific HOW (hardware family/addressability, catalog-model→
// provider resolution) and maps each kind to its pool — the LLM/ML split is the
// surface's concern now (declaredLlm vs ml). `catalog` is the static model catalog:
// supply it to resolve catalog model ids to their providers (needed to emit
// ExternalResources entries); omit it (headless) to defer that to a holder of the
// catalog. hasWebSearch is NOT a binding (no id-keyed resource) — it is an
// engine-env signal, so it is read from the nodes directly, not from the surface.
export function deriveRequirements(workflow: Workflow, catalog: ModelInfo[] = []): DeployRequirements {
  const surface = workflowBindingRequirements(workflow);

  const hardwareChannels: HardwareChannel[] = [];
  const mqttChannels: MqttChannel[] = [];
  const cameraChannels: CameraChannel[] = [];
  const customLLMModels: CustomLLMModel[] = [];
  const customMLModels: CustomMLModel[] = [];
  const ragMemories: RagMemory[] = [];
  const catalogModelIds: string[] = [];

  for (const [id, req] of Object.entries(surface) as [string, Requirement][]) {
    switch (req.kind) {
      case "hardware": {
        // Camera is a hardware family on the seam, but the OSS enrichment keeps it
        // in its own pool (a CameraSource is nothing like a gpio chip+line).
        const ch = requireChannel(workflow, id);
        if (req.family === "camera") cameraChannels.push({ id: ch.id, label: ch.label });
        else hardwareChannels.push(hardwareChannelOf(ch));
        break;
      }
      case "mqtt": {
        const ch = requireChannel(workflow, id);
        mqttChannels.push({ id: ch.id, label: ch.label });
        break;
      }
      case "declaredLlm": {
        // The surface already split the family: "declaredLlm" is an LLMModel (an
        // MLModel arrives as "ml" below). LLM models drive the provider/
        // llama-server path.
        const m = requireModel(workflow, id);
        customLLMModels.push({ id: m.id, label: m.label });
        break;
      }
      case "ml": {
        // MLModels are served by the ml-inference component, not an LLM provider.
        const m = requireModel(workflow, id);
        customMLModels.push({ id: m.id, label: m.label });
        break;
      }
      case "rag": {
        // Nothing to enrich: OSS binds no retrieval collection. Pooled so
        // assertDeployable can refuse with the ids the operator must remove.
        const m = requireMemory(workflow, id);
        ragMemories.push({ id: m.id, label: m.label });
        break;
      }
      case "catalogLlm":
        catalogModelIds.push(id);
        break;
      default:
        return assertNeverKind(req);
    }
  }

  let hasWebSearch = false;
  for (const canvas of Object.values(workflow.canvases)) {
    for (const node of canvas.nodes) {
      if (node.type === "WebSearchTool") hasWebSearch = true;
    }
  }

  // Resolve catalog model ids to their distinct providers via the catalog. With no
  // catalog the map is unknown: leave provider requirements empty (hasProviderModel
  // still flags that credentials are needed), record nothing as unresolved. We keep
  // only the provider set — catalog models are routed by llmproxy, not mapped, so
  // per-model provider ids aren't needed downstream.
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const unresolvedCatalogModels: string[] = [];
  const providerIds = new Set<string>();
  if (catalog.length > 0) {
    for (const id of catalogModelIds) {
      const info = byId.get(id);
      if (!info) unresolvedCatalogModels.push(id);
      else providerIds.add(info.provider);
    }
  }

  return {
    hasProviderModel: catalogModelIds.length > 0,
    catalogProviders: [...providerIds].map((id) => ({ id })),
    unresolvedCatalogModels,
    hasWebSearch,
    hardwareChannels,
    mqttChannels,
    cameraChannels,
    customLLMModels,
    customMLModels,
    ragMemories,
  };
}
