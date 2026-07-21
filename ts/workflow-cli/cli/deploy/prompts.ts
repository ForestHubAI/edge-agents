// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Interactive prompt layer: fills any value the flags didn't provide.
// This is the "ask" step. Flags pre-fill; prompts cover the rest.

import { confirm, editor, input, password, select } from "@inquirer/prompts";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { promptCustomComponents } from "./components";
import type { DeployComponent, LoadedComponent } from "./components";
import {
  ggufNameError,
  hardwareAddressKey,
  hardwareAddressLabel,
  mlModelNameError,
  isAddressable,
  hardwareBindings,
  cameraBindings,
  mqttBindings,
  llmBindings,
  mlBindings,
} from "./types";
import type {
  BoundOf,
  CameraBinding,
  DeployConfig,
  DeployRequirements,
  HardwareBinding,
  HardwareFamily,
  LLMModelBinding,
  MLModelBinding,
  MqttBinding,
  NonCameraHardware,
  WebSearchBinding,
} from "./types";

// Prompt-default device path per hardware family.
const HARDWARE_EXAMPLE: Record<Exclude<HardwareFamily, "camera">, string> = {
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
  channels: NonCameraHardware[],
  seed: Record<string, HardwareBinding>,
): Promise<Record<string, HardwareBinding>> {
  const result: Record<string, HardwareBinding> = { ...seed };
  const claimed = new Map<string, string>(); // address key -> first claiming channel's label
  const claim = (key: string, label: string): void => {
    if (!claimed.has(key)) claimed.set(key, label);
  };
  for (const ch of channels) {
    const b = result[ch.id];
    if (b?.chipOrDevice && (!isAddressable(ch.family) || b.index !== undefined)) {
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
    if (isAddressable(ch.family)) {
      const idx = await input({
        message: `${ch.label}: channel index / GPIO line`,
        validate: (v) => {
          const uint = isUint(v);
          if (uint !== true) return uint;
          const holder = claimed.get(hardwareAddressKey(ch.family, dev, Number(v.trim())));
          return holder
            ? `${hardwareAddressLabel(ch.family, dev, Number(v.trim()))} is already used by "${holder}" — pick a free one`
            : true;
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
async function promptMqtt(channels: BoundOf<"mqtt">[], seed: Record<string, MqttBinding>): Promise<Record<string, MqttBinding>> {
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
// device -> a llama component this bundle generates (a model filename);
// network -> an endpoint the operator runs elsewhere (its URL + optional key).
async function promptLLMModels(
  models: BoundOf<"declaredLlm">[],
  seed: Record<string, LLMModelBinding>,
): Promise<Record<string, LLMModelBinding>> {
  const result: Record<string, LLMModelBinding> = { ...seed };
  for (const m of models) {
    if (result[m.id]) continue;
    const location = await select<"device" | "network">({
      message: `${m.label}: where does this model run?`,
      choices: [
        { value: "device", name: "on this device (served by the shared llama server)" },
        { value: "network", name: "on another machine on the network (call its endpoint URL)" },
      ],
    });

    if (location === "device") {
      const modelFile = await input({
        message: `${m.label}: model filename, dropped in the llama workspace dir (e.g. model.gguf)`,
        validate: (v) => ggufNameError(v) ?? true,
      });
      const ctxSize = await input({ message: `${m.label}: context window in tokens`, default: "4096", validate: isUint });
      result[m.id] = {
        location: "device",
        modelFile: modelFile.trim(),
        ctxSize: Number(ctxSize.trim()),
      };
      continue;
    }

    const url = await input({
      message: `${m.label}: inference endpoint URL (a server you run — llama/vLLM/Ollama)`,
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

// Per custom ML model: where it runs, then the name the component selects it by.
// device -> served by the shared inference component this bundle generates (the
// name is the model's sub-folder in the repository the operator fills); network
// -> an endpoint the operator runs elsewhere (the name must match what that
// component calls the model; its URL, no credential).
async function promptMLModels(models: BoundOf<"ml">[], seed: Record<string, MLModelBinding>): Promise<Record<string, MLModelBinding>> {
  const result: Record<string, MLModelBinding> = { ...seed };
  for (const m of models) {
    if (result[m.id]) continue;
    const location = await select<"device" | "network">({
      message: `${m.label}: where does this model run?`,
      choices: [
        { value: "device", name: "on this device (served by the shared inference component)" },
        { value: "network", name: "on another machine on the network (call its endpoint URL)" },
      ],
    });

    const model = (
      await input({
        message: `${m.label}: model name the component selects on (e.g. yolov8n)`,
        validate: (v) => mlModelNameError(v) ?? true,
      })
    ).trim();

    if (location === "device") {
      result[m.id] = { location: "device", model };
      continue;
    }

    const url = await input({
      message: `${m.label}: inference endpoint URL (a component you run elsewhere)`,
      default: "http://localhost:8000",
      validate: (v) => v.trim().length > 0 || "endpoint URL is required",
    });
    result[m.id] = { location: "network", url: url.trim(), model };
  }
  return result;
}

// Per camera channel: first HOW the camera is reached, then what that path needs.
// The kind is the access path, not the sensor's form factor — a CSI sensor is
// v4l2 on boards that expose a preconfigured node and libcamera on boards that
// don't. It picks the capture recipe, which the driver component owns, so nothing
// here asks for a pipeline (except `raw`, the escape hatch).
async function promptCameras(channels: BoundOf<"hardware">[], seed: Record<string, CameraBinding>): Promise<Record<string, CameraBinding>> {
  const result: Record<string, CameraBinding> = { ...seed };
  for (const ch of channels) {
    if (result[ch.id]) continue;
    const kind = await select<CameraBinding["kind"]>({
      message: `${ch.label}: how is this camera reached?`,
      choices: [
        { value: "v4l2", name: "v4l2 — a device node (USB/UVC webcam, or a CSI sensor your board exposes as /dev/video*)" },
        { value: "libcamera", name: "libcamera — a CSI camera your board drives through libcamera (e.g. Raspberry Pi)" },
        { value: "rtsp", name: "rtsp — an IP camera streaming over RTSP" },
        { value: "http", name: "http — a camera served over HTTP (MJPEG stream or snapshot endpoint)" },
        { value: "raw", name: "raw — anything else: supply a capture-source fragment yourself" },
        { value: "debug", name: "debug — a fixed synthetic frame, no hardware (development)" },
      ],
    });

    if (kind === "debug") {
      result[ch.id] = { kind: "debug" };
      continue;
    }

    if (kind === "rtsp" || kind === "http") {
      const url = (
        await input({
          message: `${ch.label}: stream URL (no credentials — they are asked for separately)`,
          default: kind === "rtsp" ? "rtsp://camera.local:554/stream1" : "http://camera.local/video.mjpg",
          validate: (v) => v.trim().length > 0 || "stream URL is required",
        })
      ).trim();
      const user = (await input({ message: `${ch.label}: username (blank if the stream is open)` })).trim();
      // The password never enters the spec: the resolver pulls it into the driver
      // component's secret document, keyed by this camera's ref.
      const pw = user ? (await password({ message: `${ch.label}: password (stored in the component's secrets file)` })).trim() : "";
      const binding: Extract<CameraBinding, { kind: "rtsp" | "http" }> = { kind, url };
      if (user) binding.user = user;
      if (pw) binding.password = pw;
      const warmupNet = await promptWarmupFrames(ch.label);
      if (warmupNet > 0) binding.warmupFrames = warmupNet;
      result[ch.id] = binding;
      continue;
    }

    {
      const device =
        kind === "v4l2"
          ? (
              await input({
                message: `${ch.label}: device path (prefer a stable /dev/v4l/by-id/... path)`,
                default: "/dev/video0",
                validate: (v) => v.trim().length > 0 || "device path is required",
              })
            ).trim()
          : "";
      const cameraName =
        kind === "libcamera"
          ? (
              await input({
                message: `${ch.label}: sensor name (blank for the platform default; e.g. /base/soc/i2c0mux/imx477@1a)`,
              })
            ).trim()
          : "";
      const pipeline =
        kind === "raw"
          ? (
              await input({
                message: `${ch.label}: capture-source fragment (GStreamer, used verbatim)`,
                default: "videotestsrc",
                validate: (v) => v.trim().length > 0 || "a capture-source fragment is required",
              })
            ).trim()
          : "";
      const warmup = Number(
        (
          await input({
            message: `${ch.label}: warmup frames to discard so auto-exposure settles (0 to disable, ~5-8 for CSI cameras)`,
            default: "0",
            validate: (v) => {
              const n = Number(v.trim());
              return (Number.isInteger(n) && n >= 0) || "enter a whole number >= 0";
            },
          })
        ).trim(),
      );
      // Statically configured CSI/ISP pipelines need their media-ctl/v4l2-ctl
      // sequence (from the board docs) replayed on every container start. The
      // sequence is multi-line, so it is pasted into $EDITOR in one go.
      let setup: string[] = [];
      const needsSetup = await confirm({
        message: `${ch.label}: add setup commands? (only for statically configured pipelines, see README)`,
        default: false,
      });
      while (needsSetup) {
        const text = await editor({
          message: `${ch.label}: setup commands (opens $EDITOR — default vim; e.g. EDITOR=nano to change)`,
          postfix: ".sh",
          default:
            "# One shell command per line; comment lines are dropped.\n" +
            "# All lines run as one script at every container start (see the bundle README).\n",
        });
        setup = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith("#"));
        if (setup.length > 0) break;
        // Empty result (editor closed without saving, only comments, or an
        // $EDITOR that doesn't edit) would silently drop the setup step.
        const proceed = await confirm({
          message: `${ch.label}: the editor returned no commands — continue without a setup step? (No re-opens the editor)`,
          default: false,
        });
        if (proceed) break;
      }
      let devices: string[] = [];
      if (setup.length > 0) {
        devices = (
          await input({
            message: `${ch.label}: device nodes those commands touch, space-separated (e.g. /dev/media0 /dev/v4l-subdev0)`,
          })
        )
          .split(/\s+/)
          .filter((s) => s.length > 0);
      }
      const binding: Extract<CameraBinding, { kind: "v4l2" | "libcamera" | "raw" }> =
        kind === "v4l2"
          ? { kind, device }
          : kind === "libcamera"
            ? { kind, ...(cameraName ? { cameraName } : {}) }
            : { kind: "raw", pipeline };
      if (warmup > 0) binding.warmupFrames = warmup;
      if (setup.length > 0) binding.setup = setup;
      if (devices.length > 0) binding.devices = devices;
      result[ch.id] = binding;
    }
  }
  return result;
}

// Leading frames to discard so a sensor's auto-exposure settles. Shared by every
// kind that reads a live source.
async function promptWarmupFrames(label: string): Promise<number> {
  return Number(
    (
      await input({
        message: `${label}: warmup frames to discard so auto-exposure settles (0 to disable, ~5-8 for CSI cameras)`,
        default: "0",
        validate: (v) => {
          const n = Number(v.trim());
          return (Number.isInteger(n) && n >= 0) || "enter a whole number >= 0";
        },
      })
    ).trim(),
  );
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
  const hwTodo = hardwareBindings(req).filter((ch) => !partial.hardware?.[ch.id]);
  const mqttTodo = mqttBindings(req).filter((ch) => !partial.mqtt?.[ch.id]);
  const llmModelsTodo = llmBindings(req).filter((m) => !partial.llmModels?.[m.id]);
  const mlModelsTodo = mlBindings(req).filter((m) => !partial.mlModels?.[m.id]);
  const camerasTodo = cameraBindings(req).filter((ch) => !partial.cameras?.[ch.id]);
  const askKeys = req.catalogProviders.length > 0;
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
    [
      askKeys,
      hwTodo.length > 0,
      mqttTodo.length > 0,
      llmModelsTodo.length > 0,
      mlModelsTodo.length > 0,
      camerasTodo.length > 0,
      askWeb,
      askOut,
    ].filter(Boolean).length + 1;
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

  // LLM keys: one prompt per catalog provider the workflow's Agents actually
  // reference (from the derived requirements) — not a blanket pick-from-all. A
  // custom-only workflow references no catalog provider and skips this. Every key
  // runs that provider locally (`localLlm`); there is no backend option in OSS.
  const llmKeys: Record<string, string> = { ...(partial.llmKeys ?? {}) };
  if (askKeys) {
    section("LLM provider keys", req.catalogProviders.length);
    for (const prov of req.catalogProviders) {
      if (llmKeys[prov.id]) continue; // already supplied via flag / --values
      const key = await password({ message: `${prov.id} API key`, mask: "*" });
      if (key) llmKeys[prov.id] = key;
    }
  }

  // Resource values: each helper asks only for what the partial didn't pre-fill,
  // so each header is gated on that same "has open items" check.
  if (hwTodo.length > 0) section("Hardware channels", hwTodo.length);
  const hardware = await promptHardware(hardwareBindings(req), partial.hardware ?? {});
  if (mqttTodo.length > 0) section("MQTT brokers", mqttTodo.length);
  const mqtt = await promptMqtt(mqttBindings(req), partial.mqtt ?? {});
  if (llmModelsTodo.length > 0) section("Custom LLM models", llmModelsTodo.length);
  const llmModels = await promptLLMModels(llmBindings(req), partial.llmModels ?? {});
  if (mlModelsTodo.length > 0) section("Custom ML models", mlModelsTodo.length);
  const mlModels = await promptMLModels(mlBindings(req), partial.mlModels ?? {});
  if (camerasTodo.length > 0) section("Cameras", camerasTodo.length);
  const cameras = await promptCameras(cameraBindings(req), partial.cameras ?? {});
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
    cameras,
    webSearch,
  };
  return { config, customComponents, componentEnv };
}
