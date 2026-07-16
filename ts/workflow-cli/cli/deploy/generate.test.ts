// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { describe, it, expect } from "vitest";
import { composeYaml, envFile, readme, slugify } from "./generate";
import type { DeployConfig } from "./types";
import type { DeploymentSchemas, EngineSchemas } from "./api";

type Spec = DeploymentSchemas["DeploymentSpec"];
type DeployComponent = DeploymentSchemas["DeployComponent"];

// composeYaml renders only from the spec; readme also reads cfg. Neither reads
// config.workflow, so a bare workflow stub is enough to build a spec to render.
const bareWorkflow = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  functions: [],
  declaredVariables: [],
  channels: [],
  memory: [],
  models: [],
} as EngineSchemas["EngineConfig"]["workflow"];

// The engine as the resolver produces it: a generic component with the config
// blob, the memory volume, and (when hardware is present) devices/privileged/user.
function engineComponent(overrides: Partial<DeployComponent> = {}): DeployComponent {
  return {
    name: "engine",
    image: "engine:latest",
    pull: "never",
    config: { workflow: bareWorkflow },
    volumes: ["./workspaces/engine:/var/lib/foresthub/workspace"],
    ...overrides,
  };
}

// The shared on-device llama-server component: image + the models list as a config
// blob (config.json), weights in the workspace mount.
function llamaComponent(overrides: Partial<DeployComponent> = {}): DeployComponent {
  return {
    name: "llama-server",
    image: "ghcr.io/ggml-org/llama.cpp:server-b8589",
    config: { models: [{ id: "gemma-3", file: "gemma.gguf", args: ["--ctx-size", "4096"] }] },
    volumes: ["./workspaces/llama-server:/var/lib/foresthub/workspace:ro"],
    ...overrides,
  };
}

// The shared inference component (ml-inference): self-built, pull:never.
function onnxComponent(overrides: Partial<DeployComponent> = {}): DeployComponent {
  return {
    name: "ml-inference",
    image: "ml-inference:latest",
    pull: "never",
    volumes: ["./workspaces/ml-inference:/var/lib/foresthub/workspace:ro"],
    ...overrides,
  };
}

// The shared capture component (camera): self-built, pull:never.
function cameraComponent(overrides: Partial<DeployComponent> = {}): DeployComponent {
  return {
    name: "camera",
    image: "camera:latest",
    pull: "never",
    config: { cameras: { video0: { kind: "v4l2", device: "/dev/video0" } } },
    ...overrides,
  };
}

function specOf(components: DeployComponent[] = [engineComponent()]): Spec {
  return { schemaVersion: 1, id: "test", components };
}

function cfgOf(p: Partial<DeployConfig> = {}): DeployConfig {
  return { llmKeys: {}, outputDir: "out", force: false, logLevel: "info", hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {}, ...p };
}

describe("slugify", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(slugify("My Workflow!")).toBe("my-workflow");
  });
  it("trims leading/trailing dashes", () => {
    expect(slugify("  a__b  ")).toBe("a-b");
  });
});

describe("envFile", () => {
  it("always writes the log level and no empty sections", () => {
    const env = envFile(cfgOf({ logLevel: "warn" }));
    expect(env).toContain("ENGINE_LOG_LEVEL=warn");
    expect(env).not.toContain("API_KEY");
    expect(env).not.toContain("WEB_SEARCH");
  });

  it("never writes provider keys into env — they ride secrets.json now", () => {
    const env = envFile(cfgOf({ llmKeys: { Anthropic: "sk-x" } }));
    expect(env).not.toContain("sk-x");
    expect(env).not.toContain("API_KEY");
  });

  it("writes the web-search section only when configured", () => {
    const env = envFile(cfgOf({ webSearch: { provider: "brave", apiKey: "ws-key" } }));
    expect(env).toContain("ENGINE_WEB_SEARCH_PROVIDER=brave");
    expect(env).toContain("ENGINE_WEB_SEARCH_API_KEY=ws-key");
  });

  it("never writes resource secrets into env — they ride a mounted file now", () => {
    expect(envFile(cfgOf())).not.toContain("FH_RESOURCE_SECRETS");
  });
});

describe("composeYaml", () => {
  it("mounts the secret doc read-only and stamps a secrets-hash when the owner has secrets", () => {
    const yaml = composeYaml(specOf(), { engine: { "mqtt-b": "pw" } });
    expect(yaml).toContain("./engine-secrets.json:/etc/foresthub/secrets.json:ro");
    expect(yaml).toContain("com.foresthub.secrets-hash:");
    // The secret value itself never lands in the compose file — only a hash of it.
    expect(yaml).not.toContain("pw");
  });

  it("omits the secret mount and label when there is no secret doc", () => {
    const yaml = composeYaml(specOf());
    expect(yaml).not.toContain("engine-secrets.json");
    expect(yaml).not.toContain("secrets-hash");
    // An empty doc for the owner is treated as no doc (anonymous broker / keyless).
    expect(composeYaml(specOf(), { engine: {} })).not.toContain("engine-secrets.json");
  });

  it("mounts the config file at the convention path and has no hardware blocks for a bare spec", () => {
    const yaml = composeYaml(specOf());
    expect(yaml).toContain("./engine-config.json:/etc/foresthub/config.json:ro");
    // No environment block — operator values arrive via env_file, the engine reads
    // the config path it defaults to, so no ENGINE_*_FILE vars in the compose.
    expect(yaml).not.toContain("environment:");
    expect(yaml).not.toContain("ENGINE_CONFIG_FILE");
    expect(yaml).toContain("env_file:");
    expect(yaml).toContain("- path: engine.env");
    expect(yaml).toContain("required: false");
    expect(yaml).not.toContain('user: "0:0"');
    expect(yaml).not.toContain("devices:");
    expect(yaml).not.toContain("privileged:");
  });

  it("pins the engine image from the spec string", () => {
    expect(composeYaml(specOf([engineComponent({ image: "engine:0.4.2" })]))).toContain("image: engine:0.4.2");
  });

  it("emits each component's pull policy: the engine's explicit never, default missing otherwise", () => {
    expect(composeYaml(specOf())).toContain("pull_policy: never"); // engine sets pull: never
    const yaml = composeYaml(specOf([engineComponent(), llamaComponent()]));
    expect(yaml).toContain("pull_policy: missing"); // llama omits pull → default missing
  });

  it("maps a cdev device grant and runs root when the resolver set it", () => {
    const yaml = composeYaml(specOf([engineComponent({ devices: ["/dev/gpiochip0"], user: "0:0" })]));
    expect(yaml).toContain('- "/dev/gpiochip0:/dev/gpiochip0"');
    expect(yaml).toContain('user: "0:0"');
    expect(yaml).not.toContain("privileged:");
  });

  it("runs privileged with root but maps no device node when the spec says so", () => {
    const yaml = composeYaml(specOf([engineComponent({ privileged: true, user: "0:0" })]));
    expect(yaml).toContain("privileged: true");
    expect(yaml).toContain('user: "0:0"');
    expect(yaml).not.toContain("devices:");
  });

  it("maps multiple device grants", () => {
    const yaml = composeYaml(specOf([engineComponent({ devices: ["/dev/gpiochip0", "/dev/ttyUSB0"], user: "0:0" })]));
    expect(yaml).toContain('- "/dev/gpiochip0:/dev/gpiochip0"');
    expect(yaml).toContain('- "/dev/ttyUSB0:/dev/ttyUSB0"');
  });

  it("keeps operator secrets out of the compose (they live in the env file)", () => {
    const yaml = composeYaml(specOf());
    expect(yaml).not.toContain("OPENAI_API_KEY");
    expect(yaml).not.toContain("ENGINE_WEB_SEARCH_API_KEY");
  });

  it("an on-device model adds the shared llama component with no start-ordering", () => {
    const yaml = composeYaml(specOf([engineComponent(), llamaComponent()]));
    expect(yaml).toContain("llama-server:");
    expect(yaml).toContain("image: ghcr.io/ggml-org/llama.cpp:server-b8589");
    // The models list rides in the mounted config.json, not a compose command.
    expect(yaml).toContain("./llama-server-config.json:/etc/foresthub/config.json:ro");
    // Dropped: the engine connects at runtime with retry, so no health gate.
    expect(yaml).not.toContain("depends_on:");
    expect(yaml).not.toContain("healthcheck:");
    expect(yaml).not.toContain("service_healthy");
    expect(yaml).not.toContain("network_mode: host");
  });

  it("mounts the llama models list as a config file, not a compose command", () => {
    const yaml = composeYaml(specOf([engineComponent(), llamaComponent()]));
    expect(yaml).toContain("./llama-server-config.json:/etc/foresthub/config.json:ro");
    expect(yaml).toContain("com.foresthub.config-hash:");
    expect(yaml).not.toContain("command:");
  });

  it("sets no fixed container_name (so multiple bundles can share a host)", () => {
    expect(composeYaml(specOf())).not.toContain("container_name");
  });

  it("mounts the engine workspace as a host bind dir, not a named volume", () => {
    const yaml = composeYaml(specOf());
    expect(yaml).toContain("- ./workspaces/engine:/var/lib/foresthub/workspace");
    expect(yaml).not.toContain("engine-memory");
  });

  it("stamps a config-hash label that changes with the config content", () => {
    const a = composeYaml(specOf());
    expect(a).toContain("com.foresthub.config-hash:");
    // Same config → same hash (stable); different config → different hash, so
    // `docker compose up -d` recreates the container on a workflow/binding edit.
    const grab = (y: string) => /config-hash: "([0-9a-f]+)"/.exec(y)?.[1];
    expect(grab(a)).toBe(grab(composeYaml(specOf())));
    const b = composeYaml(specOf([engineComponent({ config: { workflow: { ...bareWorkflow, schemaVersion: 2 } } })]));
    expect(grab(b)).not.toBe(grab(a));
  });

  it("no llama component means no component service", () => {
    const yaml = composeYaml(specOf());
    expect(yaml).not.toContain("server-b8589");
  });

  it("renders a custom component as a service through the same generic mapping", () => {
    const grafana: DeployComponent = {
      name: "grafana",
      image: "grafana/grafana:11.3.0",
      ports: ["3000:3000"],
      volumes: ["grafana-storage:/var/lib/grafana"],
    };
    const yaml = composeYaml(specOf([engineComponent(), grafana]));
    expect(yaml).toContain("grafana:");
    expect(yaml).toContain("image: grafana/grafana:11.3.0");
    expect(yaml).toContain("pull_policy: missing"); // no pull set → default
    expect(yaml).toContain('- "3000:3000"');
    expect(yaml).toContain("- path: grafana.env");
    expect(yaml).toContain("  grafana-storage:"); // declared as a top-level named volume
  });

  it("renders the camera component with device passthrough and its config by convention", () => {
    const yaml = composeYaml(specOf([engineComponent(), cameraComponent({ devices: ["/dev/video0"] })]));
    expect(yaml).toContain("camera:");
    expect(yaml).toContain("image: camera:latest");
    expect(yaml).toContain("pull_policy: never");
    expect(yaml).toContain('- "/dev/video0:/dev/video0"');
    // Its config blob is mounted like every other component's — the driver
    // component needs no bespoke mount and no workspace dir.
    expect(yaml).toContain("./camera-config.json:/etc/foresthub/config.json:ro");
    expect(yaml).not.toContain("workspaces/camera");
    // No container_name is set (several bundles may share one host).
    expect(yaml).not.toContain("container_name");
    expect(yaml).not.toMatch(/^volumes:/m);
  });
});

describe("readme", () => {
  it("a bare workflow lists the boot files and no notes", () => {
    const md = readme(specOf(), cfgOf(), false);
    expect(md).toContain("`engine-config.json`");
    expect(md).toContain("`deployment-spec.json`");
    expect(md).not.toContain("## Hardware access");
    expect(md).not.toContain("## External resources");
    expect(md).not.toContain("## LLM provider keys");
  });

  it("hardware adds the note and the scp transfer entries", () => {
    const md = readme(specOf([engineComponent({ devices: ["/dev/gpiochip0"], user: "0:0" })]), cfgOf(), false);
    expect(md).toContain("## Hardware access");
    expect(md).toContain("scp engine.tar docker-compose.yml engine-config.json deployment-spec.json engine.env");
  });

  it("mqtt adds the external-resources note, with no host-networking advice", () => {
    const md = readme(specOf(), cfgOf({ mqtt: { m: { brokerUrl: "tcp://b:1883" } } }), false);
    expect(md).toContain("## External resources");
    expect(md).toContain("chmod 600");
    expect(md).not.toContain("network_mode: host");
  });

  it("an on-device model adds the on-device note with the model file", () => {
    const md = readme(specOf([engineComponent(), llamaComponent()]), cfgOf({ llmModels: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }), false);
    expect(md).toContain("## On-device models");
    expect(md).toContain("- `./workspaces/llama-server/gemma.gguf`");
    expect(md).not.toContain("## Network models");
  });

  it("a network model adds the network-models note", () => {
    const md = readme(specOf(), cfgOf({ llmModels: { llm: { location: "network", url: "http://x:8080" } } }), false);
    expect(md).toContain("## Network models");
    expect(md).not.toContain("## On-device models");
  });

  it("a catalog model surfaces the provider-keys section", () => {
    expect(readme(specOf(), cfgOf(), true)).toContain("## LLM provider keys");
  });

  it("a set provider key surfaces the provider-keys section even without a catalog model", () => {
    expect(readme(specOf(), cfgOf({ llmKeys: { openai: "sk-x" } }), false)).toContain("## LLM provider keys");
  });

  it("web search adds its note", () => {
    expect(readme(specOf(), cfgOf({ webSearch: { provider: "brave", apiKey: "x" } }), false)).toContain("## Web search");
  });

  it("a device model adds the model scp transfer and inspects all containers on run", () => {
    const md = readme(specOf([engineComponent(), llamaComponent()]), cfgOf({ llmModels: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }), false);
    expect(md).toContain("scp -r workspaces/");
    expect(md).toContain("docker compose ps");
  });

  it("a bundle without an on-device model tails only the engine log", () => {
    const md = readme(specOf(), cfgOf(), false);
    expect(md).toContain("docker compose logs -f engine");
    expect(md).not.toContain("scp -r models/");
    expect(md).not.toContain("docker compose ps");
  });

  it("a device ml model adds the shared inference component note", () => {
    const md = readme(specOf(), cfgOf({ mlModels: { yolo: { location: "device", model: "yolov8n" } } }), false);
    expect(md).toContain("## On-device ML models");
    expect(md).toContain("ml-inference");
  });

  it("a network ml model adds only the network note", () => {
    const md = readme(specOf(), cfgOf({ mlModels: { yolo: { location: "network", url: "http://onnx:8000", model: "yolov8n" } } }), false);
    expect(md).toContain("## Network ML models");
    expect(md).not.toContain("## On-device ML models");
  });

  it("a gstreamer camera adds the media-graph operator note", () => {
    const md = readme(specOf(), cfgOf({ cameras: { csi: { kind: "libcamera" } } }), false);
    expect(md).toContain("## On-device cameras");
    expect(md).toContain("/dev/media*");
  });

  it("a network camera adds only the network note", () => {
    const md = readme(specOf(), cfgOf({ cameras: { cam: { kind: "rtsp", url: "rtsp://cam.remote/s1" } } }), false);
    expect(md).toContain("## Network cameras");
    expect(md).not.toContain("## On-device cameras");
  });

  it("documents building, saving and loading a self-built ML component image", () => {
    const md = readme(specOf([engineComponent(), onnxComponent()]), cfgOf({ mlModels: { yolo: { location: "device", model: "yolov8n" } } }), false);
    expect(md).toContain("docker build -t ml-inference:latest py/ml-inference");
    expect(md).toContain("docker save ml-inference:latest");
    expect(md).toContain("docker load -i ml-inference.tar");
    expect(md).toContain("scp engine.tar ml-inference.tar");
  });

  it("documents building and loading a self-built camera component image", () => {
    const md = readme(
      specOf([engineComponent(), cameraComponent()]),
      cfgOf({ cameras: { cam: { kind: "v4l2", device: "/dev/video0" } } }),
      false,
    );
    expect(md).toContain("docker build -f go/Dockerfile.camera -t camera:latest go");
    expect(md).toContain("docker load -i camera.tar");
  });

  it("adds no component build step when nothing is self-built (network ML model, llama)", () => {
    const md = readme(specOf([engineComponent(), llamaComponent()]), cfgOf({ mlModels: { yolo: { location: "network", url: "http://onnx:8000", model: "yolov8n" } } }), false);
    expect(md).not.toContain("docker build -t ml-inference");
    expect(md).not.toContain("docker load -i ml-inference.tar");
  });
});

describe("composeYaml — camera component", () => {
  it("mounts the camera's config by the standard convention, with no special case", () => {
    // The driver component carries its boot config like any other component, so
    // it gets <name>-config.json at the contract path — nothing camera-specific.
    const camera = cameraComponent({ config: { cameras: { video0: { kind: "v4l2", device: "/dev/video0" } } } });
    const yaml = composeYaml(specOf([engineComponent(), camera]));
    expect(yaml).toContain("./camera-config.json:/etc/foresthub/config.json:ro");
    expect(yaml).not.toContain("cameras.json");
  });

  it("mounts the camera's own secret doc when a stream authenticates", () => {
    const camera = cameraComponent({ config: { cameras: { gate: { kind: "rtsp", url: "rtsp://cam/s1" } } } });
    const yaml = composeYaml(specOf([engineComponent(), camera]), { camera: { gate: "hunter2" } });
    expect(yaml).toContain("./camera-secrets.json:/etc/foresthub/secrets.json:ro");
    expect(yaml).not.toContain("hunter2");
  });
});
