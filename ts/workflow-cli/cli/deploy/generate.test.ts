import { describe, it, expect } from "vitest";
import { composeYaml, ctxSizeVar, envFile, readme, slugify } from "./generate";
import type { DeployConfig } from "./types";
import type { DeploymentSchemas } from "@foresthubai/workflow-core/api";

type Spec = DeploymentSchemas["DeploymentSpec"];
type EngineComponent = DeploymentSchemas["EngineComponent"];
type LlamaServer = DeploymentSchemas["LlamaServerComponent"];

// composeYaml/readme read only the engine component's version/grants/privileged,
// the llamaServer, and cfg — never config.workflow — so a bare workflow stub is
// enough to build a spec to render.
const bareWorkflow = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  functions: [],
  declaredVariables: [],
  channels: [],
  memory: [],
  models: [],
} as DeploymentSchemas["EngineConfig"]["workflow"];

function specOf(engine: Partial<EngineComponent> = {}, llama?: LlamaServer): Spec {
  return {
    schemaVersion: 1,
    id: "test",
    status: "active",
    components: {
      engine: { image: { repository: "fh-engine", tag: "latest" }, config: { workflow: bareWorkflow }, ...engine },
      ...(llama ? { llamaServer: llama } : {}),
    },
  };
}

function cfgOf(p: Partial<DeployConfig> = {}): DeployConfig {
  return { llmKeys: {}, outputDir: "out", force: false, logLevel: "info", hardware: {}, mqtt: {}, models: {}, ...p };
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

  it("writes the on-device models section only when a model runs on-device", () => {
    expect(envFile(cfgOf({ models: { m: { location: "device", modelFile: "x.gguf" } } }))).toContain("LLAMA_CTX_SIZE_M=4096");
    expect(envFile(cfgOf({ models: { m: { location: "network", url: "http://x:8080" } } }))).not.toContain("LLAMA_CTX_SIZE");
  });

  it("writes one context-size var per on-device model", () => {
    const env = envFile(cfgOf({ models: { a: { location: "device", modelFile: "a.gguf" }, b: { location: "device", modelFile: "b.gguf" } } }));
    expect(env).toContain("LLAMA_CTX_SIZE_A=4096");
    expect(env).toContain("LLAMA_CTX_SIZE_B=4096");
  });

  it("writes the chosen context size when the binding sets one", () => {
    expect(envFile(cfgOf({ models: { m: { location: "device", modelFile: "x.gguf", ctxSize: 8192 } } }))).toContain("LLAMA_CTX_SIZE_M=8192");
  });
});

describe("composeYaml", () => {
  it("mounts the single engine config file and has no hardware blocks for a bare spec", () => {
    const yaml = composeYaml(specOf(), cfgOf());
    expect(yaml).toContain("ENGINE_CONFIG_FILE: /etc/foresthub/engine-config.json");
    expect(yaml).toContain("./engine-config.json:/etc/foresthub/engine-config.json:ro");
    // The former per-file env vars are gone — the engine reads one unified file.
    expect(yaml).not.toContain("ENGINE_DEVICE_MANIFEST_FILE");
    expect(yaml).not.toContain("ENGINE_EXTERNAL_RESOURCES_FILE");
    expect(yaml).not.toContain("ENGINE_DEPLOYMENT_MAPPING_FILE");
    expect(yaml).not.toContain('user: "0:0"');
    expect(yaml).not.toContain("devices:");
    expect(yaml).not.toContain("privileged:");
  });

  it("pins the engine image from the spec coordinate (by tag)", () => {
    expect(composeYaml(specOf({ image: { repository: "fh-engine", tag: "0.4.2" } }), cfgOf())).toContain("image: fh-engine:0.4.2");
  });

  it("pins by digest when the coordinate carries one", () => {
    const yaml = composeYaml(
      specOf({ image: { repository: "ghcr.io/foresthubai/engine", tag: "1.1.0", digest: "sha256:abc123" } }),
      cfgOf(),
    );
    expect(yaml).toContain("image: ghcr.io/foresthubai/engine@sha256:abc123");
    expect(yaml).not.toContain(":1.1.0");
  });

  it("maps a cdev device grant and runs root", () => {
    const yaml = composeYaml(specOf({ deviceGrants: ["/dev/gpiochip0"] }), cfgOf());
    expect(yaml).toContain('- "/dev/gpiochip0:/dev/gpiochip0"');
    expect(yaml).toContain('user: "0:0"');
    expect(yaml).not.toContain("privileged:");
  });

  it("runs privileged with root but maps no device node when the spec says so", () => {
    const yaml = composeYaml(specOf({ privileged: true }), cfgOf());
    expect(yaml).toContain("privileged: true");
    expect(yaml).toContain('user: "0:0"');
    expect(yaml).not.toContain("devices:");
  });

  it("maps multiple device grants", () => {
    const yaml = composeYaml(specOf({ deviceGrants: ["/dev/gpiochip0", "/dev/ttyUSB0"] }), cfgOf());
    expect(yaml).toContain('- "/dev/gpiochip0:/dev/gpiochip0"');
    expect(yaml).toContain('- "/dev/ttyUSB0:/dev/ttyUSB0"');
  });

  it("web search adds its env interpolations when cfg has it", () => {
    const yaml = composeYaml(specOf(), cfgOf({ webSearch: { provider: "brave", apiKey: "x" } }));
    expect(yaml).toContain("ENGINE_WEB_SEARCH_PROVIDER: ${ENGINE_WEB_SEARCH_PROVIDER:-brave}");
    expect(yaml).toContain("ENGINE_WEB_SEARCH_API_KEY: ${ENGINE_WEB_SEARCH_API_KEY:-}");
  });

  it("a set provider key becomes an interpolated env line", () => {
    expect(composeYaml(specOf(), cfgOf({ llmKeys: { openai: "x" } }))).toContain("OPENAI_API_KEY: ${OPENAI_API_KEY:-}");
  });

  it("an on-device model adds a llama sidecar and an engine depends_on", () => {
    const yaml = composeYaml(
      specOf({}, { image: { repository: "ghcr.io/ggml-org/llama.cpp", tag: "server-b8589" }, models: [{ id: "gemma-3", modelFile: "gemma.gguf" }] }),
      cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }),
    );
    expect(yaml).toContain("llama-gemma-3:");
    expect(yaml).toContain("image: ghcr.io/ggml-org/llama.cpp:server-b8589");
    expect(yaml).toContain("/models/gemma.gguf");
    expect(yaml).toContain("depends_on:");
    expect(yaml).toContain("condition: service_healthy");
    expect(yaml).toContain("${LLAMA_CTX_SIZE_GEMMA_3:-4096}");
    expect(yaml).not.toContain("network_mode: host");
  });

  it("renders a sidecar's port and context size from the spec, not the hardcoded defaults", () => {
    const yaml = composeYaml(
      specOf({}, { image: { repository: "ghcr.io/ggml-org/llama.cpp", tag: "server-b8589" }, models: [{ id: "gemma-3", modelFile: "gemma.gguf", port: 9090, ctxSize: 8192 }] }),
      cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf", port: 9090, ctxSize: 8192 } } }),
    );
    expect(yaml).toContain('- "9090"'); // --port arg
    expect(yaml).toContain("http://localhost:9090/health"); // healthcheck on the same port
    expect(yaml).toContain("${LLAMA_CTX_SIZE_GEMMA_3:-8192}"); // ctx fallback from the spec
    expect(yaml).not.toContain('- "8080"');
  });

  it("sets no fixed container_name (so multiple bundles can share a host)", () => {
    expect(composeYaml(specOf(), cfgOf())).not.toContain("container_name");
  });

  it("stamps an engine-config-hash label that changes with the config content", () => {
    const a = composeYaml(specOf(), cfgOf());
    expect(a).toContain("com.foresthub.engine-config-hash:");
    // Same config → same hash (stable); different config → different hash, so
    // `docker compose up -d` recreates the engine on a workflow/binding edit.
    const grab = (y: string) => /engine-config-hash: "([0-9a-f]+)"/.exec(y)?.[1];
    expect(grab(a)).toBe(grab(composeYaml(specOf(), cfgOf())));
    const b = composeYaml(specOf({ config: { workflow: { ...bareWorkflow, schemaVersion: 2 } } }), cfgOf());
    expect(grab(b)).not.toBe(grab(a));
  });

  it("no llamaServer component means no sidecar service", () => {
    const yaml = composeYaml(specOf(), cfgOf({ models: { llm: { location: "network", url: "http://x:8080" } } }));
    expect(yaml).not.toContain("server-b8589");
    expect(yaml).not.toContain("depends_on:");
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
    const md = readme(specOf({ deviceGrants: ["/dev/gpiochip0"] }), cfgOf(), false);
    expect(md).toContain("## Hardware access");
    expect(md).toContain("scp fh-engine.tar docker-compose.yml engine-config.json deployment-spec.json .env");
  });

  it("mqtt adds the external-resources note, with no host-networking advice", () => {
    const md = readme(specOf(), cfgOf({ mqtt: { m: { brokerUrl: "tcp://b:1883" } } }), false);
    expect(md).toContain("## External resources");
    expect(md).toContain("chmod 600");
    expect(md).not.toContain("network_mode: host");
  });

  it("an on-device model adds the on-device note with the model file", () => {
    const md = readme(
      specOf({}, { image: { repository: "ghcr.io/ggml-org/llama.cpp", tag: "server-b8589" }, models: [{ id: "gemma-3", modelFile: "gemma.gguf" }] }),
      cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }),
      false,
    );
    expect(md).toContain("## On-device models");
    expect(md).toContain("- `./models/gemma.gguf`");
    expect(md).not.toContain("## Network models");
  });

  it("a network model adds the network-models note", () => {
    const md = readme(specOf(), cfgOf({ models: { llm: { location: "network", url: "http://x:8080" } } }), false);
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
    const md = readme(
      specOf({}, { image: { repository: "ghcr.io/ggml-org/llama.cpp", tag: "server-b8589" }, models: [{ id: "gemma-3", modelFile: "gemma.gguf" }] }),
      cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }),
      false,
    );
    expect(md).toContain("scp -r models/");
    expect(md).toContain("docker compose ps");
  });

  it("a bundle without an on-device model tails only the engine log", () => {
    const md = readme(specOf(), cfgOf(), false);
    expect(md).toContain("docker compose logs -f engine");
    expect(md).not.toContain("scp -r models/");
    expect(md).not.toContain("docker compose ps");
  });
});

describe("ctxSizeVar", () => {
  it("derives an uppercased, underscore-safe env var per model id", () => {
    expect(ctxSizeVar("gemma-3")).toBe("LLAMA_CTX_SIZE_GEMMA_3");
    expect(ctxSizeVar("qwen.2_5")).toBe("LLAMA_CTX_SIZE_QWEN_2_5");
  });
});
