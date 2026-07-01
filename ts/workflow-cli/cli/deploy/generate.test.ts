import { describe, it, expect } from "vitest";
import { composeYaml, envFile, readme, slugify } from "./generate";
import type { DeployConfig } from "./types";
import type { DeploymentSchemas, EngineSchemas } from "@foresthubai/workflow-core/api";

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
    image: "fh-engine:latest",
    pull: "never",
    config: { workflow: bareWorkflow },
    volumes: ["./workspaces/engine:/var/lib/foresthub/workspace"],
    ...overrides,
  };
}

// An on-device model's llama-server sidecar: image + frozen CLI flags, no config.
function llamaComponent(overrides: Partial<DeployComponent> = {}): DeployComponent {
  return {
    name: "llama-gemma-3",
    image: "ghcr.io/ggml-org/llama.cpp:server-b8589",
    command: ["--model", "/var/lib/foresthub/workspace/gemma.gguf", "--host", "0.0.0.0", "--port", "8080", "--ctx-size", "4096"],
    volumes: ["./workspaces/llama-gemma-3:/var/lib/foresthub/workspace:ro"],
    ...overrides,
  };
}

function specOf(components: DeployComponent[] = [engineComponent()]): Spec {
  return { schemaVersion: 1, id: "test", status: "active", components };
}

function cfgOf(p: Partial<DeployConfig> = {}): DeployConfig {
  return { llmKeys: {}, outputDir: "out", force: false, logLevel: "info", hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, ...p };
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

  it("writes a provider key when set", () => {
    expect(envFile(cfgOf({ llmKeys: { anthropic: "sk-x" } }))).toContain("ANTHROPIC_API_KEY=sk-x");
  });

  it("writes the web-search section only when configured", () => {
    const env = envFile(cfgOf({ webSearch: { provider: "brave", apiKey: "ws-key" } }));
    expect(env).toContain("ENGINE_WEB_SEARCH_PROVIDER=brave");
    expect(env).toContain("ENGINE_WEB_SEARCH_API_KEY=ws-key");
  });

  it("writes the resource-secrets blob only when there are secrets", () => {
    expect(envFile(cfgOf(), { "mqtt-b": { password: "pw" } })).toContain("FH_RESOURCE_SECRETS=");
    expect(envFile(cfgOf())).not.toContain("FH_RESOURCE_SECRETS=");
  });
});

describe("composeYaml", () => {
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
    expect(composeYaml(specOf([engineComponent({ image: "fh-engine:0.4.2" })]))).toContain("image: fh-engine:0.4.2");
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

  it("an on-device model adds a llama sidecar with no start-ordering and a frozen command", () => {
    const yaml = composeYaml(specOf([engineComponent(), llamaComponent()]));
    expect(yaml).toContain("llama-gemma-3:");
    expect(yaml).toContain("image: ghcr.io/ggml-org/llama.cpp:server-b8589");
    expect(yaml).toContain("/var/lib/foresthub/workspace/gemma.gguf");
    // Dropped: the engine connects at runtime with retry, so no health gate.
    expect(yaml).not.toContain("depends_on:");
    expect(yaml).not.toContain("healthcheck:");
    expect(yaml).not.toContain("service_healthy");
    expect(yaml).not.toContain("network_mode: host");
  });

  it("renders the sidecar's port and context size frozen in the command", () => {
    const llama = llamaComponent({ command: ["--model", "/var/lib/foresthub/workspace/gemma.gguf", "--host", "0.0.0.0", "--port", "9090", "--ctx-size", "8192"] });
    const yaml = composeYaml(specOf([engineComponent(), llama]));
    expect(yaml).toContain('- "9090"');
    expect(yaml).toContain('- "8192"');
    expect(yaml).not.toContain('- "8080"');
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

  it("no llama component means no sidecar service", () => {
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
    expect(md).toContain("scp fh-engine.tar docker-compose.yml engine-config.json deployment-spec.json engine.env");
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
    expect(md).toContain("- `./workspaces/llama-gemma-3/gemma.gguf`");
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
});
