import type { Workflow } from "../workflow";
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

// What a workflow needs from its environment, derived from its content alone —
// no operator input. Drives both input collection (which bindings to ask for)
// and the spec resolver's completeness check. The component-set derivation the
// migration doc names as must-not-be-duplicated lives here, shared by every
// producer.
export interface DeployRequirements {
  // At least one Agent references a catalog model (not declared in
  // workflow.models) — that model needs a provider key as engine env.
  hasProviderModel: boolean;
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
// for the catalog-model / retriever / web-search signals.
export function deriveRequirements(workflow: Workflow): DeployRequirements {
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

  return {
    hasProviderModel: getReferencedCatalogModelIds(workflow).length > 0,
    hasRetriever,
    hasWebSearch,
    hardwareChannels,
    mqttChannels,
    customModels,
  };
}
