import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeOutput } from "./write";
import type { DeployConfig, DeployRequirements } from "./types";
import type { DeploymentSchemas, EngineSchemas } from "@foresthubai/workflow-core/api";

type Spec = DeploymentSchemas["DeploymentSpec"];
type DeployComponent = DeploymentSchemas["DeployComponent"];

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

function specOf(components: DeployComponent[] = [engineComponent()]): Spec {
  return { schemaVersion: 1, id: "test", status: "active", components };
}

function reqOf(p: Partial<DeployRequirements> = {}): DeployRequirements {
  return {
    hasProviderModel: false,
    hasRetriever: false,
    hasWebSearch: false,
    hardwareChannels: [],
    mqttChannels: [],
    cameraChannels: [],
    customLLMModels: [],
    customMLModels: [],
    ...p,
  };
}
function cfgOf(outputDir: string, p: Partial<DeployConfig> = {}): DeployConfig {
  return { llmKeys: {}, outputDir, force: false, logLevel: "info", hardware: {}, mqtt: {}, llmModels: {}, mlModels: {}, cameras: {}, ...p };
}

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "fhwrite-"));
const names = async (dir: string) => (await fs.readdir(dir)).sort();
const mode = async (file: string) => (await fs.stat(file)).mode & 0o777;

// The written-file artifacts (writeOutput's return value). The on-disk bundle also
// has a "workspaces" dir (pre-created bind-mount dirs), which is not a written file.
const BUNDLE = ["README.md", "deployment-spec.json", "docker-compose.yml", "engine-config.json", "engine.env"].sort();

describe("writeOutput", () => {
  it("writes a per-component config, the spec, compose, env and readme", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    await writeOutput(specOf(), {}, cfgOf(out), reqOf());
    expect(await names(out)).toEqual([...BUNDLE, "workspaces"].sort());
    await fs.rm(base, { recursive: true, force: true });
  });

  // Only engine.env is secret now (provider keys + FH_RESOURCE_SECRETS); the spec
  // and config files are secret-free by construction. Windows ignores POSIX modes
  // (every file reports 0o666), so the bit-level check is POSIX-only.
  it.skipIf(process.platform === "win32")("engine.env is the only 0o600 file; the JSON artifacts are not", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    await writeOutput(specOf(), { "mqtt-1": { password: "p" } }, cfgOf(out), reqOf());
    expect(await mode(path.join(out, "engine.env"))).toBe(0o600);
    expect(await mode(path.join(out, "engine-config.json"))).not.toBe(0o600);
    expect(await mode(path.join(out, "deployment-spec.json"))).not.toBe(0o600);
    expect(await mode(path.join(out, "docker-compose.yml"))).not.toBe(0o600);
    await fs.rm(base, { recursive: true, force: true });
  });

  it("writes resource secrets into engine.env, never into the spec or config", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    await writeOutput(specOf(), { "mqtt-1": { password: "brokerpw" } }, cfgOf(out), reqOf());
    const env = await fs.readFile(path.join(out, "engine.env"), "utf-8");
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
    expect(files.map((f) => path.basename(f)).sort()).toEqual(BUNDLE);
    await fs.rm(base, { recursive: true, force: true });
  });

  it("creates each component's workspace dir from its bind mounts", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const llama: DeployComponent = { name: "llama-x", image: "llama", volumes: ["./workspaces/llama-x:/var/lib/foresthub/workspace:ro"] };
    await writeOutput(specOf([engineComponent(), llama]), {}, cfgOf(out), reqOf());
    expect((await fs.stat(path.join(out, "workspaces", "engine"))).isDirectory()).toBe(true);
    expect((await fs.stat(path.join(out, "workspaces", "llama-x"))).isDirectory()).toBe(true);
    await fs.rm(base, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32")("writes a custom component's <name>.env with mode 0o600", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const grafana: DeployComponent = { name: "grafana", image: "grafana/grafana:11.3.0" };
    await writeOutput(specOf([engineComponent(), grafana]), {}, cfgOf(out), reqOf(), {
      grafana: "GF_SECURITY_ADMIN_PASSWORD=secret\n",
    });
    expect(await mode(path.join(out, "grafana.env"))).toBe(0o600);
    expect(await fs.readFile(path.join(out, "grafana.env"), "utf-8")).toContain("GF_SECURITY_ADMIN_PASSWORD=secret");
    await fs.rm(base, { recursive: true, force: true });
  });

  it("writes a <name>-config.json for a custom component carrying config", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const custom: DeployComponent = { name: "dash", image: "x", config: { foo: "bar" } };
    await writeOutput(specOf([engineComponent(), custom]), {}, cfgOf(out), reqOf());
    expect(JSON.parse(await fs.readFile(path.join(out, "dash-config.json"), "utf-8"))).toEqual({ foo: "bar" });
    await fs.rm(base, { recursive: true, force: true });
  });

  it("writes the capture sidecar's cameras.json as a file for on-device cameras", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const camera: DeployComponent = {
      name: "fh-camera",
      image: "fh-camera:latest",
      volumes: ["./workspaces/fh-camera/cameras.json:/etc/foresthub/cameras.json:ro"],
    };
    const cfg = cfgOf(out, { cameras: { front: { location: "device", source: "v4l2", device: "/dev/video0" } } });
    await writeOutput(specOf([engineComponent(), camera]), {}, cfg, reqOf());
    const camerasFile = path.join(out, "workspaces", "fh-camera", "cameras.json");
    // The file-mount source is written as a file — not created as a directory.
    expect((await fs.stat(camerasFile)).isFile()).toBe(true);
    expect(JSON.parse(await fs.readFile(camerasFile, "utf-8"))).toEqual({ cameras: { front: { source: "v4l2", device: "/dev/video0" } } });
    await fs.rm(base, { recursive: true, force: true });
  });
});
