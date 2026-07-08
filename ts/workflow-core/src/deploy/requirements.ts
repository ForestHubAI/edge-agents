// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { Workflow } from "../workflow";
import type { ModelInfo } from "../model";
import { NodeRegistry, isNodeUsedAsTool } from "../node";
import { isParameterActive } from "../parameter";

/**
 * Model ids that nodes reference but the workflow does not declare in `models`.
 * A `modelSelect` accepts exactly two sources — declared custom models and the
 * static catalog — so any referenced id that isn't a declared model is a catalog
 * model: it carries no declared config, yet still needs a provider/credential
 * supplied at deploy.
 *
 * This is the one deploy demand the workflow's resource arrays can't express:
 * channels/memory/declared-models are enumerable directly from
 * `workflow.{channels,memory,models}`, but catalog model ids live only on the
 * nodes that pick them — hence the walk. Spans every canvas (main + function
 * bodies) and honors parameter activation, so a model behind an inactive
 * `modelSelect` (pruned on serialize, never deployed) is not counted.
 */
export function getReferencedCatalogModelIds(workflow: Workflow): string[] {
  const declaredModel = new Set(Object.keys(workflow.models));
  const catalogIds = new Set<string>();

  for (const canvas of Object.values(workflow.canvases)) {
    for (const node of canvas.nodes) {
      const def = NodeRegistry.getByType(node.type);
      if (!def) continue;
      const args = node.arguments as Record<string, unknown>;
      const isToolInput = isNodeUsedAsTool(node.id, node, canvas.edges);
      for (const param of def.parameters) {
        if (param.type !== "modelSelect") continue;
        if (!isParameterActive(param, args, isToolInput)) continue;
        const id = args[param.id];
        if (typeof id === "string" && id !== "" && !declaredModel.has(id)) {
          catalogIds.add(id);
        }
      }
    }
  }

  return [...catalogIds];
}

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

// One custom/self-hosted model declared in workflow.models — needs an
// ExternalResources provider entry (a device sidecar or a network endpoint).
export interface CustomModel {
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
  // Every declared custom model; each becomes an ExternalResources provider + a
  // mapping (and a llama-server sidecar when bound on-device).
  customModels: CustomModel[];
}

// Drift sentinel: a new ChannelType widens the switch input and breaks
// compilation here until the new type is classified above.
function assertNeverChannel(t: never): never {
  throw new Error(`unhandled channel type: ${String(t)}`);
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

  const customModels: CustomModel[] = Object.values(workflow.models).map((m) => ({ id: m.id, label: m.label }));

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
    customModels,
  };
}
