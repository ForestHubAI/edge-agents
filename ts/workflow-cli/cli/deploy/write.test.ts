import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeOutput } from "./write";
import type { DeployConfig, DeployRequirements } from "./types";
import type { DeploymentSchemas } from "@foresthubai/workflow-core/api";

type Spec = DeploymentSchemas["DeploymentSpec"];
type EngineComponent = DeploymentSchemas["EngineComponent"];
type LlamaServer = DeploymentSchemas["LlamaServerComponent"];

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
function cfgOf(outputDir: string, p: Partial<DeployConfig> = {}): DeployConfig {
  return { llmKeys: {}, outputDir, force: false, logLevel: "info", hardware: {}, mqtt: {}, models: {}, ...p };
}

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "fhwrite-"));
const names = async (dir: string) => (await fs.readdir(dir)).sort();
const mode = async (file: string) => (await fs.stat(file)).mode & 0o777;

describe("writeOutput", () => {
  it("writes the unified config, the spec, compose, env and readme", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    await writeOutput(specOf(), {}, cfgOf(out), reqOf());
    expect(await names(out)).toEqual(
      [".env", "README.md", "deployment-spec.json", "docker-compose.yml", "engine-config.json"].sort(),
    );
    await fs.rm(base, { recursive: true, force: true });
  });

  // Only .env is secret now (provider keys + FH_RESOURCE_SECRETS); the spec and
  // engine config are secret-free by construction. Windows ignores POSIX modes
  // (every file reports 0o666), so the bit-level check is POSIX-only.
  it.skipIf(process.platform === "win32")(".env is the only 0o600 file; the JSON artifacts are not", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    await writeOutput(specOf(), { "mqtt-1": { password: "p" } }, cfgOf(out), reqOf());
    expect(await mode(path.join(out, ".env"))).toBe(0o600);
    expect(await mode(path.join(out, "engine-config.json"))).not.toBe(0o600);
    expect(await mode(path.join(out, "deployment-spec.json"))).not.toBe(0o600);
    expect(await mode(path.join(out, "docker-compose.yml"))).not.toBe(0o600);
    await fs.rm(base, { recursive: true, force: true });
  });

  it("writes resource secrets into .env, never into the spec or engine config", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    await writeOutput(specOf(), { "mqtt-1": { password: "brokerpw" } }, cfgOf(out), reqOf());
    const env = await fs.readFile(path.join(out, ".env"), "utf-8");
    expect(env).toContain("FH_RESOURCE_SECRETS=");
    expect(env).toContain("brokerpw");
    const spec = await fs.readFile(path.join(out, "deployment-spec.json"), "utf-8");
    expect(spec).not.toContain("brokerpw");
    await fs.rm(base, { recursive: true, force: true });
  });

  it("returns the paths it wrote", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const files = await writeOutput(specOf(), {}, cfgOf(out), reqOf());
    expect(files.map((f) => path.basename(f)).sort()).toEqual(
      [".env", "README.md", "deployment-spec.json", "docker-compose.yml", "engine-config.json"].sort(),
    );
    await fs.rm(base, { recursive: true, force: true });
  });

  it("creates a models/ directory for an on-device model", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const spec = specOf({}, { image: { repository: "ghcr.io/ggml-org/llama.cpp", tag: "server-b8589" }, models: [{ id: "llm", modelFile: "m.gguf" }] });
    const cfg = cfgOf(out, { models: { llm: { location: "device", modelFile: "m.gguf" } } });
    await writeOutput(spec, {}, cfg, reqOf({ customModels: [{ id: "llm", label: "llm" }] }));
    expect((await fs.stat(path.join(out, "models"))).isDirectory()).toBe(true);
    await fs.rm(base, { recursive: true, force: true });
  });
});
