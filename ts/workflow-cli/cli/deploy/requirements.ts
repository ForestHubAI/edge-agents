// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// The OSS CLI's rich requirement analysis: sort a workflow's declared resources
// into the typed pools the deploy artifacts need (hardware families, MQTT, camera,
// custom LLM/ML models) and resolve referenced catalog models to their providers.
// This is Stage-1 input prep, NOT a cross-language seam: the backend has no twin —
// it works off the coarse id->kind binding surface (workflowBindingRequirements,
// in @foresthubai/workflow-core/deploy) and derives its own packaging. The one
// piece the backend DOES independently reproduce — the catalog-model walk — stays
// in core as getReferencedCatalogModelIds; everything below builds on it and is
// CLI-owned OSS packaging.

import type { Workflow } from "@foresthubai/workflow-core/workflow";
import type { ModelInfo } from "@foresthubai/workflow-core/model";
import { getReferencedCatalogModelIds } from "@foresthubai/workflow-core/deploy";

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

// One camera channel the workflow declares — needs an ExternalResources camera
// entry + a mapping (and a share of the capture component when bound on-device).
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
  // The workflow has a Retriever node. A standalone engine has no retriever, so
  // the node cannot resolve — a producer may refuse to deploy.
  hasRetriever: boolean;
  // The workflow has a WebSearchTool node — needs a web-search key as engine env.
  hasWebSearch: boolean;
  // Every hardware channel, in declaration order; drives the device manifest +
  // mapping + container device passthrough.
  hardwareChannels: HardwareChannel[];
  // Every MQTT channel; each becomes an ExternalResources entry + a mapping.
  mqttChannels: MqttChannel[];
  // Every camera channel; each becomes an ExternalResources entry + a mapping
  // (and a share of the capture component when bound on-device).
  cameraChannels: CameraChannel[];
  // Every declared custom LLM model; each becomes an ExternalResources provider
  // + a mapping (and a llama-server component when bound on-device).
  customLLMModels: CustomLLMModel[];
  // Every declared custom ML model; each becomes an ExternalResources entry + a
  // mapping (and a share of the inference component when bound on-device).
  customMLModels: CustomMLModel[];
}

// Drift sentinel: a new ChannelType widens the switch input and breaks
// compilation here until the new type is classified above.
function assertNeverChannel(t: never): never {
  throw new Error(`unhandled channel type: ${String(t)}`);
}

// Drift sentinel: a new ModelType breaks compilation here until it is sorted
// into the LLM / ML pool below.
function assertNeverModel(t: never): never {
  throw new Error(`unhandled model type: ${String(t)}`);
}

// deriveRequirements reads what a workflow demands of its environment. Pure —
// no I/O, no operator input. Sorts every declared channel into the hardware /
// MQTT pools the deploy artifacts need and walks nodes (main + function bodies)
// for the catalog-model / retriever / web-search signals. `catalog` is the
// static model catalog: supply it to resolve referenced catalog model ids to
// their providers (needed to emit ExternalResources entries); omit it (headless)
// to leave that resolution to a caller that holds the catalog.
export function deriveRequirements(workflow: Workflow, catalog: ModelInfo[] = []): DeployRequirements {
  const hardwareChannels: HardwareChannel[] = [];
  const mqttChannels: MqttChannel[] = [];
  const cameraChannels: CameraChannel[] = [];

  for (const channel of Object.values(workflow.channels)) {
    switch (channel.type) {
      case "GPIOIN":
      case "GPIOOUT":
        hardwareChannels.push({ id: channel.id, label: channel.label, family: "gpio", addressable: true });
        break;
      case "ADC":
        hardwareChannels.push({ id: channel.id, label: channel.label, family: "adc", addressable: true });
        break;
      case "DAC":
        hardwareChannels.push({ id: channel.id, label: channel.label, family: "dac", addressable: true });
        break;
      case "PWM":
        hardwareChannels.push({ id: channel.id, label: channel.label, family: "pwm", addressable: true });
        break;
      case "UART":
        hardwareChannels.push({ id: channel.id, label: channel.label, family: "serial", addressable: false });
        break;
      case "MQTT":
        mqttChannels.push({ id: channel.id, label: channel.label });
        break;
      case "CAMERA":
        cameraChannels.push({ id: channel.id, label: channel.label });
        break;
      case "LOG":
        // Resolves to the ambient engine logger — no platform resource to bind, so
        // it demands nothing of the deploy environment.
        break;
      default:
        return assertNeverChannel(channel.type);
    }
  }

  let hasRetriever = false;
  let hasWebSearch = false;
  for (const canvas of Object.values(workflow.canvases)) {
    for (const node of canvas.nodes) {
      if (node.type === "Retriever") hasRetriever = true;
      else if (node.type === "WebSearchTool") hasWebSearch = true;
    }
  }

  // wf.models holds both model families; split them by type. LLM models drive
  // the provider/llama-server path, ML models the inference component — mixing
  // them would send an ML model down the LLM provider build.
  const customLLMModels: CustomLLMModel[] = [];
  const customMLModels: CustomMLModel[] = [];
  for (const m of Object.values(workflow.models)) {
    switch (m.type) {
      case "LLMModel":
        customLLMModels.push({ id: m.id, label: m.label });
        break;
      case "MLModel":
        customMLModels.push({ id: m.id, label: m.label });
        break;
      default:
        return assertNeverModel(m.type);
    }
  }

  // Resolve referenced catalog ids to their distinct providers via the catalog.
  // With no catalog the map is unknown: leave provider requirements empty
  // (hasProviderModel still flags that credentials are needed), record nothing
  // as unresolved. We keep only the provider set — catalog models are routed by
  // llmproxy, not mapped, so per-model provider ids aren't needed downstream.
  const referenced = getReferencedCatalogModelIds(workflow);
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const unresolvedCatalogModels: string[] = [];
  const providerIds = new Set<string>();
  if (catalog.length > 0) {
    for (const id of referenced) {
      const info = byId.get(id);
      if (!info) unresolvedCatalogModels.push(id);
      else providerIds.add(info.provider);
    }
  }

  return {
    hasProviderModel: referenced.length > 0,
    catalogProviders: [...providerIds].map((id) => ({ id })),
    unresolvedCatalogModels,
    hasRetriever,
    hasWebSearch,
    hardwareChannels,
    mqttChannels,
    cameraChannels,
    customLLMModels,
    customMLModels,
  };
}
