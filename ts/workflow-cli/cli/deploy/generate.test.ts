import { describe, it, expect } from "vitest";
import { composeYaml, ctxSizeVar, envFile, readme, slugify } from "./generate";
import type { DeployConfig, DeployRequirements, HardwareFamily } from "./types";

function reqOf(p: Partial<DeployRequirements> = {}): DeployRequirements {
  return {
    hasProviderModel: false,
    hasRetriever: false,
    hasWebSearch: false,
    hardwareChannels: [],
    mqttChannels: [],
    customModels: [],
    ...p,
  };
}

function cfgOf(p: Partial<DeployConfig> = {}): DeployConfig {
  return { llmKeys: {}, outputDir: "out", force: false, logLevel: "info", hardware: {}, mqtt: {}, models: {}, ...p };
}

const hw = (id: string, family: HardwareFamily) => ({ id, label: id, family, addressable: family !== "serial" });

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
});

describe("composeYaml", () => {
  it("a bare workflow has no deploy-file env/mounts and no hardware blocks", () => {
    const yaml = composeYaml(cfgOf(), reqOf());
    expect(yaml).toContain("ENGINE_CONFIG_FILE: /etc/foresthub/workflow.json");
    expect(yaml).not.toContain("ENGINE_DEVICE_MANIFEST_FILE");
    expect(yaml).not.toContain("ENGINE_EXTERNAL_RESOURCES_FILE");
    expect(yaml).not.toContain('user: "0:0"');
    expect(yaml).not.toContain("devices:");
    expect(yaml).not.toContain("privileged:");
  });

  it("gpio adds the manifest env, a mount, a device, and root", () => {
    const yaml = composeYaml(
      cfgOf({ hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 0 } } }),
      reqOf({ hardwareChannels: [hw("btn", "gpio")] }),
    );
    expect(yaml).toContain("ENGINE_DEVICE_MANIFEST_FILE: /etc/foresthub/device_manifest.json");
    expect(yaml).toContain("ENGINE_DEPLOYMENT_MAPPING_FILE: /etc/foresthub/deployment_mapping.json");
    expect(yaml).toContain("./device_manifest.json:/etc/foresthub/device_manifest.json:ro");
    expect(yaml).toContain('- "/dev/gpiochip0:/dev/gpiochip0"');
    expect(yaml).toContain('user: "0:0"');
    expect(yaml).not.toContain("privileged:");
  });

  it("adc runs privileged with root but maps no device node", () => {
    const yaml = composeYaml(
      cfgOf({ hardware: { a: { chipOrDevice: "/sys/bus/iio/devices/iio:device0", index: 0 } } }),
      reqOf({ hardwareChannels: [hw("a", "adc")] }),
    );
    expect(yaml).toContain("privileged: true");
    expect(yaml).toContain('user: "0:0"');
    expect(yaml).not.toContain("devices:");
  });

  it("serial maps the tty device node", () => {
    const yaml = composeYaml(
      cfgOf({ hardware: { u: { chipOrDevice: "/dev/ttyUSB0" } } }),
      reqOf({ hardwareChannels: [hw("u", "serial")] }),
    );
    expect(yaml).toContain('- "/dev/ttyUSB0:/dev/ttyUSB0"');
    expect(yaml).not.toContain("privileged:");
  });

  it("mqtt adds external-resource env/mount but no hardware blocks", () => {
    const yaml = composeYaml(
      cfgOf({ mqtt: { m: { brokerUrl: "tcp://b:1883" } } }),
      reqOf({ mqttChannels: [{ id: "m", label: "m" }] }),
    );
    expect(yaml).toContain("ENGINE_EXTERNAL_RESOURCES_FILE: /etc/foresthub/external_resources.json");
    expect(yaml).toContain("ENGINE_DEPLOYMENT_MAPPING_FILE: /etc/foresthub/deployment_mapping.json");
    expect(yaml).not.toContain('user: "0:0"');
    expect(yaml).not.toContain("devices:");
  });

  it("web search adds its env interpolations", () => {
    const yaml = composeYaml(cfgOf(), reqOf({ hasWebSearch: true }));
    expect(yaml).toContain("ENGINE_WEB_SEARCH_PROVIDER: ${ENGINE_WEB_SEARCH_PROVIDER:-brave}");
    expect(yaml).toContain("ENGINE_WEB_SEARCH_API_KEY: ${ENGINE_WEB_SEARCH_API_KEY:-}");
  });

  it("a set provider key becomes an interpolated env line", () => {
    expect(composeYaml(cfgOf({ llmKeys: { openai: "x" } }), reqOf())).toContain("OPENAI_API_KEY: ${OPENAI_API_KEY:-}");
  });

  it("an on-device model adds a llama sidecar and an engine depends_on", () => {
    const yaml = composeYaml(
      cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }),
      reqOf({ customModels: [{ id: "gemma-3", label: "gemma" }] }),
    );
    expect(yaml).toContain("llama-gemma-3:");
    expect(yaml).toContain("image: ghcr.io/ggml-org/llama.cpp:server-b8589");
    expect(yaml).toContain("/models/gemma.gguf");
    expect(yaml).toContain("depends_on:");
    expect(yaml).toContain("condition: service_healthy");
    expect(yaml).toContain("${LLAMA_CTX_SIZE_GEMMA_3:-4096}");
    expect(yaml).not.toContain("network_mode: host");
  });

  it("sets no fixed container_name (so multiple bundles can share a host)", () => {
    const yaml = composeYaml(cfgOf(), reqOf());
    expect(yaml).not.toContain("container_name");
  });

  it("a network model adds no sidecar service", () => {
    const yaml = composeYaml(
      cfgOf({ models: { llm: { location: "network", url: "http://x:8080" } } }),
      reqOf({ customModels: [{ id: "llm", label: "llm" }] }),
    );
    expect(yaml).not.toContain("server-b8589");
    expect(yaml).not.toContain("depends_on:");
  });
});

describe("readme", () => {
  it("a bare workflow lists no deploy files and no notes", () => {
    const md = readme(cfgOf(), reqOf());
    expect(md).not.toContain("device_manifest.json");
    expect(md).not.toContain("## Hardware access");
    expect(md).not.toContain("## External resources");
    expect(md).not.toContain("## LLM provider keys");
  });

  it("hardware adds the file, the note, and the scp transfer entries", () => {
    const md = readme(cfgOf({ hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 0 } } }), reqOf({ hardwareChannels: [hw("btn", "gpio")] }));
    expect(md).toContain("- `device_manifest.json`");
    expect(md).toContain("## Hardware access");
    expect(md).toContain("scp fh-engine.tar docker-compose.yml workflow.json device_manifest.json deployment_mapping.json .env");
  });

  it("mqtt adds the external-resources file and note, with no host-networking advice", () => {
    const md = readme(cfgOf({ mqtt: { m: { brokerUrl: "tcp://b:1883" } } }), reqOf({ mqttChannels: [{ id: "m", label: "m" }] }));
    expect(md).toContain("- `external_resources.json`");
    expect(md).toContain("## External resources");
    expect(md).toContain("chmod 600");
    expect(md).not.toContain("network_mode: host");
  });

  it("an on-device model adds the on-device note with the model file", () => {
    const md = readme(
      cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }),
      reqOf({ customModels: [{ id: "gemma-3", label: "gemma" }] }),
    );
    expect(md).toContain("## On-device models");
    expect(md).toContain("- `./models/gemma.gguf`");
    expect(md).not.toContain("## Network models");
  });

  it("a device-only bundle has no provider, external-resources, or host-networking notes", () => {
    const md = readme(
      cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }),
      reqOf({ customModels: [{ id: "gemma-3", label: "gemma" }] }),
    );
    expect(md).not.toContain("## LLM provider keys");
    expect(md).not.toContain("## External resources");
    expect(md).not.toContain("network_mode: host");
  });

  it("a network model adds the network-models note", () => {
    const md = readme(
      cfgOf({ models: { llm: { location: "network", url: "http://x:8080" } } }),
      reqOf({ customModels: [{ id: "llm", label: "llm" }] }),
    );
    expect(md).toContain("## Network models");
    expect(md).not.toContain("## On-device models");
  });

  it("a catalog model surfaces the provider-keys section", () => {
    expect(readme(cfgOf(), reqOf({ hasProviderModel: true }))).toContain("## LLM provider keys");
  });

  it("a set provider key surfaces the provider-keys section even without a catalog model", () => {
    expect(readme(cfgOf({ llmKeys: { openai: "sk-x" } }), reqOf())).toContain("## LLM provider keys");
  });

  it("web search adds its note", () => {
    expect(readme(cfgOf(), reqOf({ hasWebSearch: true }))).toContain("## Web search");
  });

  it("a device model adds the model scp transfer and inspects all containers on run", () => {
    const md = readme(
      cfgOf({ models: { "gemma-3": { location: "device", modelFile: "gemma.gguf" } } }),
      reqOf({ customModels: [{ id: "gemma-3", label: "gemma" }] }),
    );
    expect(md).toContain("scp -r models/");
    expect(md).toContain("docker compose ps");
  });

  it("a bundle without an on-device model tails only the engine log", () => {
    const md = readme(cfgOf(), reqOf());
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
