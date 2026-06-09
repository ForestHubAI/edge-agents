import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeOutput } from "./write";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";
import type { DeployConfig, DeployRequirements } from "./types";

const wf = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
  functions: [],
  declaredVariables: [],
  channels: [],
  memory: [],
  models: [],
} as ApiWorkflow;

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
const hw = (id: string) => ({ id, label: id, family: "gpio" as const, addressable: true });

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "fhwrite-"));
const names = async (dir: string) => (await fs.readdir(dir)).sort();
const mode = async (file: string) => (await fs.stat(file)).mode & 0o777;

describe("writeOutput", () => {
  it("writes only the base files for a bare workflow", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    await writeOutput(wf, cfgOf(out), reqOf());
    expect(await names(out)).toEqual([".env", "README.md", "docker-compose.yml", "workflow.json"].sort());
    await fs.rm(base, { recursive: true, force: true });
  });

  it("adds the deploy files for hardware + mqtt and 0o600s the secrets", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const req = reqOf({ hardwareChannels: [hw("btn")], mqttChannels: [{ id: "m", label: "m", topic: "t" }] });
    const cfg = cfgOf(out, {
      hardware: { btn: { chipOrDevice: "/dev/gpiochip0", index: 0 } },
      mqtt: { m: { brokerUrl: "tcp://b:1883", password: "p" } },
    });
    await writeOutput(wf, cfg, req);
    expect(await names(out)).toEqual(
      [".env", "README.md", "deployment_mapping.json", "device_manifest.json", "docker-compose.yml", "external_resources.json", "workflow.json"].sort(),
    );
    expect(await mode(path.join(out, ".env"))).toBe(0o600);
    expect(await mode(path.join(out, "external_resources.json"))).toBe(0o600);
    expect(await mode(path.join(out, "device_manifest.json"))).not.toBe(0o600);
    await fs.rm(base, { recursive: true, force: true });
  });

  it("returns the paths it wrote", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const files = await writeOutput(wf, cfgOf(out), reqOf());
    expect(files.map((f) => path.basename(f)).sort()).toEqual([".env", "README.md", "docker-compose.yml", "workflow.json"].sort());
    await fs.rm(base, { recursive: true, force: true });
  });

  it("creates a models/ directory for an on-device model", async () => {
    const base = await tmp();
    const out = path.join(base, "bundle");
    const req = reqOf({ customModels: [{ id: "llm", label: "llm" }] });
    const cfg = cfgOf(out, { models: { llm: { location: "device", modelFile: "m.gguf" } } });
    await writeOutput(wf, cfg, req);
    expect((await fs.stat(path.join(out, "models"))).isDirectory()).toBe(true);
    await fs.rm(base, { recursive: true, force: true });
  });
});
