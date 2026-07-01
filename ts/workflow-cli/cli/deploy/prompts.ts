// Interactive prompt layer: fills any value the flags didn't provide.
// This is the "ask" step. Flags pre-fill; prompts cover the rest.

import { checkbox, input, password, select } from "@inquirer/prompts";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promptCustomComponents } from "./components";
import type { DeployComponent, LoadedComponent } from "./components";
import { ALL_PROVIDERS, ggufNameError, hardwareAddressKey, hardwareAddressLabel } from "./types";
import type {
  CustomLLMModel,
  CustomMLModel,
  DeployConfig,
  DeployRequirements,
  HardwareBinding,
  HardwareChannel,
  HardwareFamily,
  LLMModelBinding,
  MLModelBinding,
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
// A claimed-address map rejects a duplicate line/device right at the prompt;
// assertDeployable re-checks the full set later (it alone covers --values).
async function promptHardware(
  channels: HardwareChannel[],
  seed: Record<string, HardwareBinding>,
): Promise<Record<string, HardwareBinding>> {
  const result: Record<string, HardwareBinding> = { ...seed };
  const claimed = new Map<string, string>(); // address key -> first claiming channel's label
  const claim = (key: string, label: string): void => {
    if (!claimed.has(key)) claimed.set(key, label);
  };
  for (const ch of channels) {
    const b = result[ch.id];
    if (b?.chipOrDevice && (!ch.addressable || b.index !== undefined)) {
      claim(hardwareAddressKey(ch.family, b.chipOrDevice, b.index), ch.label);
    }
  }
  for (const ch of channels) {
    if (result[ch.id]) continue;
    const chipOrDevice = await input({
      message: `${ch.label} (${ch.family}): device path`,
      default: HARDWARE_EXAMPLE[ch.family],
      // Only serial claims the whole device; gpio/adc/dac/pwm share the path
      // and collide on the index below.
      validate: (v) => {
        if (ch.family !== "serial") return true;
        const holder = claimed.get(hardwareAddressKey("serial", v));
        return holder ? `${v.trim()} is already used by "${holder}" — pick another device` : true;
      },
    });
    const dev = chipOrDevice.trim();
    const binding: HardwareBinding = { chipOrDevice: dev };
    if (ch.addressable) {
      const idx = await input({
        message: `${ch.label}: channel index / GPIO line`,
        validate: (v) => {
          const uint = isUint(v);
          if (uint !== true) return uint;
          const holder = claimed.get(hardwareAddressKey(ch.family, dev, Number(v.trim())));
          return holder ? `${hardwareAddressLabel(ch.family, dev, Number(v.trim()))} is already used by "${holder}" — pick a free one` : true;
        },
      });
      binding.index = Number(idx.trim());
    }
    if (ch.family === "serial") {
      const baud = await input({ message: `${ch.label}: baud rate`, default: "115200", validate: isUint });
      binding.baud = Number(baud.trim());
    }
    result[ch.id] = binding;
    claim(hardwareAddressKey(ch.family, dev, binding.index), ch.label);
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

// Per custom LLM model: first where it runs, then the values that location needs.
// device -> a llama-server sidecar this bundle generates (a model filename);
// network -> an endpoint the operator runs elsewhere (its URL + optional key).
async function promptLLMModels(
  models: CustomLLMModel[],
  seed: Record<string, LLMModelBinding>,
): Promise<Record<string, LLMModelBinding>> {
  const result: Record<string, LLMModelBinding> = { ...seed };
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
        message: `${m.label}: model filename, dropped in its workspace dir (e.g. model.gguf)`,
        validate: (v) => ggufNameError(v) ?? true,
      });
      const ctxSize = await input({ message: `${m.label}: context window in tokens`, default: "4096", validate: isUint });
      const port = await input({ message: `${m.label}: sidecar port`, default: "8080", validate: isUint });
      result[m.id] = {
        location: "device",
        modelFile: modelFile.trim(),
        ctxSize: Number(ctxSize.trim()),
        port: Number(port.trim()),
      };
      continue;
    }

    const url = await input({
      message: `${m.label}: inference endpoint URL (a server you run — llama-server/vLLM/Ollama)`,
      default: "http://localhost:8080",
      validate: (v) => v.trim().length > 0 || "endpoint URL is required",
    });
    const apiKey = await password({ message: `${m.label}: API key (optional)`, mask: "*" });
    const binding: LLMModelBinding = { location: "network", url: url.trim() };
    if (apiKey) binding.apiKey = apiKey;
    result[m.id] = binding;
  }
  return result;
}

// Per custom ML model: where it runs. device -> served by the shared inference
// sidecar this bundle generates (nothing more to ask — the model repository is a
// directory the operator fills, one sub-folder per model id); network -> an
// endpoint the operator runs elsewhere (its URL, no credential).
async function promptMLModels(
  models: CustomMLModel[],
  seed: Record<string, MLModelBinding>,
): Promise<Record<string, MLModelBinding>> {
  const result: Record<string, MLModelBinding> = { ...seed };
  for (const m of models) {
    if (result[m.id]) continue;
    const location = await select<"device" | "network">({
      message: `${m.label}: where does this model run?`,
      choices: [
        { value: "device", name: "on this device (served by the shared inference sidecar)" },
        { value: "network", name: "on another machine on the network (call its endpoint URL)" },
      ],
    });

    if (location === "device") {
      result[m.id] = { location: "device" };
      continue;
    }

    const url = await input({
      message: `${m.label}: inference endpoint URL (a sidecar you run elsewhere)`,
      default: "http://localhost:8000",
      validate: (v) => v.trim().length > 0 || "endpoint URL is required",
    });
    result[m.id] = { location: "network", url: url.trim() };
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

// Everything the interactive wizard gathers: the operator-answer config plus the
// custom components (and their generated env files). The three are kept apart —
// DeployConfig stays exactly what buildDeploymentSpec's inputs need; the
// components ride alongside as a separate resolver argument.
export interface InteractiveResult {
  config: DeployConfig;
  customComponents: DeployComponent[];
  componentEnv: Record<string, string>;
}

export async function promptMissing(
  partial: Partial<DeployConfig>,
  outputDirDefault: string,
  req: DeployRequirements,
  workflowName: string,
  preloadedComponents: LoadedComponent[],
): Promise<InteractiveResult> {
  // Work out which sections will actually ask something this run. A section the
  // partial (flags / --values) already pre-filled stays silent, so it must get
  // neither a header nor a slot in the [step/total] denominator.
  const hwTodo = req.hardwareChannels.filter((ch) => !partial.hardware?.[ch.id]);
  const mqttTodo = req.mqttChannels.filter((ch) => !partial.mqtt?.[ch.id]);
  const llmModelsTodo = req.customLLMModels.filter((m) => !partial.llmModels?.[m.id]);
  const mlModelsTodo = req.customMLModels.filter((m) => !partial.mlModels?.[m.id]);
  const askKeys = req.hasProviderModel;
  const askWeb = req.hasWebSearch && !partial.webSearch;

  // Output asks only when the directory is still open, or the pre-filled one
  // collides with a non-empty directory and force isn't set (overwrite dialog).
  let askOut = true;
  if (partial.outputDir) {
    const resolved = path.resolve(process.cwd(), partial.outputDir);
    const nonEmpty = existsSync(resolved) && (await fs.readdir(resolved)).length > 0;
    askOut = nonEmpty && !(partial.force ?? false);
  }

  // +1: the custom-components section is always offered (a yes/no gate), so it
  // always occupies a slot in the denominator, before Output.
  const total =
    [askKeys, hwTodo.length > 0, mqttTodo.length > 0, llmModelsTodo.length > 0, mlModelsTodo.length > 0, askWeb, askOut].filter(Boolean)
      .length + 1;
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
  if (llmModelsTodo.length > 0) section("Custom LLM models", llmModelsTodo.length);
  const llmModels = await promptLLMModels(req.customLLMModels, partial.llmModels ?? {});
  if (mlModelsTodo.length > 0) section("Custom ML models", mlModelsTodo.length);
  const mlModels = await promptMLModels(req.customMLModels, partial.mlModels ?? {});
  if (askWeb) section("Web search");
  const webSearch = req.hasWebSearch ? await promptWebSearch(partial.webSearch) : undefined;

  // Custom components — operator-authored containers, unrelated to the workflow
  // graph, so always offered rather than derived. --component folders arrive
  // pre-validated and are shown as already added; the loop adds any more.
  section("Custom components");
  const { components: customComponents, env: componentEnv } = await promptCustomComponents(preloadedComponents);

  // Output directory — with collision handling. If the dir exists and is
  // non-empty, the operator can overwrite, pick another dir, or abort.
  if (askOut) section("Output");
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

  const config: DeployConfig = {
    llmKeys,
    outputDir,
    force,
    logLevel: partial.logLevel ?? "info",
    hardware,
    mqtt,
    llmModels,
    mlModels,
    webSearch,
  };
  return { config, customComponents, componentEnv };
}
