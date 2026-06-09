// The Inspector: derives what a workflow needs from its content alone.
// Pure-functional — no I/O, no operator input. This is the "read" step.

import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";
import type { CustomModel, DeployRequirements, HardwareChannel, MqttChannel } from "./types";

// The channel union, derived straight from the generated workflow contract.
// `ApiChannel["type"]` is therefore the live list of channel discriminators —
// the exhaustive switch below is checked against it (see assertNever).
type ApiChannel = ApiWorkflow["channels"][number];

// Drift sentinel. If `workflow.yaml` gains a channel type, the regenerated
// `ApiChannel` union widens, `channel` is no longer `never` here, and this call
// fails to compile until the new type is classified in the switch above.
function assertNever(channel: never): never {
  throw new Error(`unhandled channel type: ${JSON.stringify(channel)}`);
}

// Exported for testing purposes only.
//
// The only thing the CLI can reliably derive from a model id is whether it is
// custom or not. The engine resolves model -> provider by exact-match against
// each provider's static catalog (llmproxy), NOT by prefix — so the CLI cannot
// (and must not try to) infer the concrete provider. A model id declared in
// workflow.models is a custom/self-hosted model (run on-device as a sidecar or
// reached over the network); any other id is a catalog model that needs a key.
export function inspect(workflow: ApiWorkflow): DeployRequirements {
  const customModelIds = new Set((workflow.models ?? []).map((m) => m.id));
  let hasProviderModel = false;
  let hasRetriever = false;
  let hasWebSearch = false;

  // Functions carry their own `nodes` array — an Agent (or WebSearchTool, or
  // Retriever) inside a function counts too. Iterate top-level and function
  // bodies together.
  const allNodes = [...workflow.nodes, ...(workflow.functions ?? []).flatMap((f) => f.nodes ?? [])];

  for (const node of allNodes) {
    if (node.type === "Agent") {
      const modelId = node.arguments.model;
      if (!modelId) continue;
      // A custom (workflow.models) id is wired via ExternalResources, not a
      // provider key — only a non-custom (catalog) id needs an API key.
      if (!customModelIds.has(modelId)) hasProviderModel = true;
    } else if (node.type === "Retriever") {
      hasRetriever = true;
    } else if (node.type === "WebSearchTool") {
      hasWebSearch = true;
    }
  }

  // Sort every declared channel into the two pools the deploy artifacts need:
  // hardware channels (device_manifest.json) and MQTT channels (external
  // resources). `addressable` is false only for UART — every gpio/adc/dac/pwm
  // channel carries a physical sub-address (`index`), UART does not.
  const hardwareChannels: HardwareChannel[] = [];
  const mqttChannels: MqttChannel[] = [];

  for (const channel of workflow.channels) {
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
        mqttChannels.push({ id: channel.id, label: channel.label, topic: channel.topic });
        break;
      default:
        return assertNever(channel);
    }
  }

  // Every declared model is custom/self-hosted by definition (the catalog models
  // live in the engine, not in workflow.models). Each needs an ExternalResources
  // provider entry + a mapping, whether or not an Agent currently references it.
  const customModels: CustomModel[] = (workflow.models ?? []).map((m) => ({ id: m.id, label: m.label }));

  return { hasProviderModel, hasRetriever, hasWebSearch, hardwareChannels, mqttChannels, customModels };
}
