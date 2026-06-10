// Interactive prompt layer: fills any value the flags didn't provide.
// This is the "ask" step. Flags pre-fill; prompts cover the rest.

import { checkbox, input, password, select } from "@inquirer/prompts";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { ALL_PROVIDERS, ggufNameError } from "./types";
import type {
  CustomModel,
  DeployConfig,
  DeployRequirements,
  HardwareBinding,
  HardwareChannel,
  HardwareFamily,
  ModelBinding,
  MqttBinding,
  MqttChannel,
  Provider,
  WebSearchBinding,
} from "./types";

// Prompt-default device path per hardware family.
const HARDWARE_EXAMPLE: Record<HardwareFamily, string> = {
  gpio: "/dev/gpiochip0",
  adc: "/sys/bus/iio/devices/iio:device0",
  dac: "/sys/bus/iio/devices/iio:device1",
  pwm: "/sys/class/pwm/pwmchip0",
  serial: "/dev/ttyUSB0",
};

const isUint = (v: string) => /^\d+$/.test(v.trim()) || "enter a non-negative integer";

// Per hardware channel: device path + index (addressable) + baud (serial).
async function promptHardware(
  channels: HardwareChannel[],
  seed: Record<string, HardwareBinding>,
): Promise<Record<string, HardwareBinding>> {
  const result: Record<string, HardwareBinding> = { ...seed };
  for (const ch of channels) {
    if (result[ch.id]) continue;
    const chipOrDevice = await input({
      message: `${ch.label} (${ch.family}): device path`,
      default: HARDWARE_EXAMPLE[ch.family],
    });
    const binding: HardwareBinding = { chipOrDevice: chipOrDevice.trim() };
    if (ch.addressable) {
      const idx = await input({ message: `${ch.label}: channel index / GPIO line`, validate: isUint });
      binding.index = Number(idx.trim());
    }
    if (ch.family === "serial") {
      const baud = await input({ message: `${ch.label}: baud rate`, default: "115200", validate: isUint });
      binding.baud = Number(baud.trim());
    }
    result[ch.id] = binding;
  }
  return result;
}

// Per MQTT channel: broker URL + optional creds. Offers to reuse a broker
// already configured this run (same URL -> builder dedups onto one resource).
async function promptMqtt(
  channels: MqttChannel[],
  seed: Record<string, MqttBinding>,
): Promise<Record<string, MqttBinding>> {
  const result: Record<string, MqttBinding> = { ...seed };
  for (const ch of channels) {
    if (result[ch.id]) continue;
    const brokers = new Map<string, MqttBinding>();
    for (const b of Object.values(result)) brokers.set(b.brokerUrl, b);
    if (brokers.size > 0) {
      const choice = await select<string>({
        message: `${ch.label}: MQTT broker`,
        choices: [
          ...[...brokers.keys()].map((url) => ({ value: url, name: `reuse ${url}` })),
          { value: "__new__", name: "configure a new broker" },
        ],
      });
      const picked = brokers.get(choice);
      if (picked) {
        result[ch.id] = { ...picked };
        continue;
      }
    }

    const brokerUrl = await input({
      message: `${ch.label}: broker URL`,
      default: "tcp://localhost:1883",
      validate: (v) => v.trim().length > 0 || "broker URL is required",
    });
    const username = (await input({ message: `${ch.label}: username (optional)` })).trim();
    const pass = await password({ message: `${ch.label}: password (optional)`, mask: "*" });
    const binding: MqttBinding = { brokerUrl: brokerUrl.trim() };
    if (username) binding.username = username;
    if (pass) binding.password = pass;
    result[ch.id] = binding;
  }
  return result;
}

// Per custom model: first where it runs, then the values that location needs.
// device -> a llama-server sidecar this bundle generates (a model filename);
// network -> an endpoint the operator runs elsewhere (its URL + optional key).
async function promptModels(
  models: CustomModel[],
  seed: Record<string, ModelBinding>,
): Promise<Record<string, ModelBinding>> {
  const result: Record<string, ModelBinding> = { ...seed };
  for (const m of models) {
    if (result[m.id]) continue;
    const location = await select<"device" | "network">({
      message: `${m.label}: where does this model run?`,
      choices: [
        { value: "device", name: "on this device (generate a llama-server container)" },
        { value: "network", name: "on another machine on the network (call its endpoint URL)" },
      ],
    });

    if (location === "device") {
      const modelFile = await input({
        message: `${m.label}: model filename in ./models/ (e.g. model.gguf)`,
        validate: (v) => ggufNameError(v) ?? true,
      });
      result[m.id] = { location: "device", modelFile: modelFile.trim() };
      continue;
    }

    const url = await input({
      message: `${m.label}: inference endpoint URL (a server you run — llama-server/vLLM/Ollama)`,
      default: "http://localhost:8080",
      validate: (v) => v.trim().length > 0 || "endpoint URL is required",
    });
    const apiKey = await password({ message: `${m.label}: API key (optional)`, mask: "*" });
    const binding: ModelBinding = { location: "network", url: url.trim() };
    if (apiKey) binding.apiKey = apiKey;
    result[m.id] = binding;
  }
  return result;
}

// Web-search provider + key (once, when any WebSearchTool node exists).
async function promptWebSearch(seed: WebSearchBinding | undefined): Promise<WebSearchBinding> {
  if (seed) return seed;
  const provider = (await input({ message: "Web search provider", default: "brave" })).trim() || "brave";
  const apiKey = await password({ message: "Web search API key", mask: "*" });
  return { provider, apiKey };
}

export async function promptMissing(
  partial: Partial<DeployConfig>,
  outputDirDefault: string,
  req: DeployRequirements,
  workflowName?: string,
): Promise<DeployConfig> {
  // Work out which sections will actually ask something this run. A section the
  // partial (flags / --values) already pre-filled stays silent, so it must get
  // neither a header nor a slot in the [step/total] denominator.
  const hwTodo = req.hardwareChannels.filter((ch) => !partial.hardware?.[ch.id]);
  const mqttTodo = req.mqttChannels.filter((ch) => !partial.mqtt?.[ch.id]);
  const modelsTodo = req.customModels.filter((m) => !partial.models?.[m.id]);
  const askKeys = req.hasProviderModel;
  const askWeb = req.hasWebSearch && !partial.webSearch;

  // Output is always asked; every other section only when it has open items.
  const total = [askKeys, hwTodo.length > 0, mqttTodo.length > 0, modelsTodo.length > 0, askWeb, true].filter(
    Boolean,
  ).length;
  let step = 0;
  // A blank line + a numbered heading before each section that asks something.
  // The "— N to configure" tail shows only when a section covers more than one.
  const section = (label: string, count = 0): void => {
    step += 1;
    const tail = count > 1 ? ` — ${count} to configure` : "";
    process.stdout.write(`\n[${step}/${total}] ${label}${tail}\n`);
  };

  // The one line in the interactive flow that states what is being built.
  const named = workflowName ? ` for "${workflowName}"` : "";
  process.stdout.write(`\n◆ Standalone deployment bundle${named}\n  Boots on the controller — no backend, no account.\n`);

  // LLM keys: single multi-select over all four providers, skipped entirely
  // when the workflow has no catalog model. Custom-only workflows (every Agent
  // model declared in workflow.models) need no provider key.
  const llmKeys: Partial<Record<Provider, string>> = { ...(partial.llmKeys ?? {}) };
  if (askKeys) {
    section("LLM provider keys");
    const selectedProviders = await checkbox<Provider>({
      message: "Which providers should run with a local API key?",
      choices: ALL_PROVIDERS.map((p) => ({ value: p, name: p })),
    });
    // Drop keys for providers the operator unchecked, even if they came in
    // via a CLI flag — the multi-select is authoritative.
    for (const p of ALL_PROVIDERS) {
      if (!selectedProviders.includes(p)) delete llmKeys[p];
    }
    // Prompt for keys for selected providers that don't have one yet.
    for (const provider of selectedProviders) {
      if (llmKeys[provider]) continue;
      const key = await password({ message: `${provider} API key`, mask: "*" });
      if (key) llmKeys[provider] = key;
    }
  }

  // Resource values: each helper asks only for what the partial didn't pre-fill,
  // so each header is gated on that same "has open items" check.
  if (hwTodo.length > 0) section("Hardware channels", hwTodo.length);
  const hardware = await promptHardware(req.hardwareChannels, partial.hardware ?? {});
  if (mqttTodo.length > 0) section("MQTT brokers", mqttTodo.length);
  const mqtt = await promptMqtt(req.mqttChannels, partial.mqtt ?? {});
  if (modelsTodo.length > 0) section("Custom models", modelsTodo.length);
  const models = await promptModels(req.customModels, partial.models ?? {});
  if (askWeb) section("Web search");
  const webSearch = req.hasWebSearch ? await promptWebSearch(partial.webSearch) : undefined;

  // Output directory — with collision handling. If the dir exists and is
  // non-empty, the operator can overwrite, pick another dir, or abort.
  section("Output");
  let outputDir: string;
  let force = partial.force ?? false;
  {
    let candidate = partial.outputDir;
    while (true) {
      if (!candidate) {
        candidate = await input({ message: "Output directory", default: outputDirDefault });
      }
      const resolved = path.resolve(process.cwd(), candidate);
      const exists = existsSync(resolved);
      const nonEmpty = exists && (await fs.readdir(resolved)).length > 0;
      if (!nonEmpty || force) {
        outputDir = candidate;
        break;
      }
      const action = await select<"overwrite" | "another" | "abort">({
        message: `${resolved} is not empty.`,
        choices: [
          { value: "overwrite", name: "overwrite the existing files" },
          { value: "another", name: "choose a different directory" },
          { value: "abort", name: "abort" },
        ],
      });
      if (action === "abort") process.exit(0);
      if (action === "overwrite") {
        force = true;
        outputDir = candidate;
        break;
      }
      // action === "another": clear and re-prompt
      candidate = undefined;
    }
  }

  return {
    llmKeys,
    outputDir,
    force,
    logLevel: partial.logLevel ?? "info",
    hardware,
    mqtt,
    models,
    webSearch,
  };
}
