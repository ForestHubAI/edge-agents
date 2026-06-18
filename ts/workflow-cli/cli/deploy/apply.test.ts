import { describe, it, expect, vi, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyCommand, parseSpec, renderConfigFromSpec } from "./apply";
import { buildDeploymentSpec } from "@foresthubai/workflow-core/deploy";
import { MAIN_CANVAS_ID } from "@foresthubai/workflow-core/workflow";
import type { Workflow } from "@foresthubai/workflow-core/workflow";

// A resolved spec with one GPIO output, produced through the real resolver so the
// embedded workflow round-trips through deserialize on the apply side.
function gpioSpec() {
  const wf: Workflow = {
    canvases: { [MAIN_CANVAS_ID]: { nodes: [], edges: [], variables: {} } },
    functions: {},
    channels: { led: { id: "led", label: "led", type: "GPIOOUT", arguments: {} } },
    memory: {},
    models: {},
  };
  return buildDeploymentSpec(
    wf,
    { hardware: { led: { chipOrDevice: "/dev/gpiochip0", index: 1 } }, mqtt: {}, models: {} },
    {
      id: "d",
      status: "active",
      engineImage: { repository: "fh-engine", tag: "0.4.2" },
      llamaServerImage: { repository: "ghcr.io/ggml-org/llama.cpp", tag: "server-b8589" },
    },
  ).spec;
}

function silence() {
  vi.spyOn(process.stdout, "write").mockReturnValue(true);
  vi.spyOn(process.stderr, "write").mockReturnValue(true);
}
function trapExit() {
  silence();
  return vi.spyOn(process, "exit").mockImplementation(((c?: number) => {
    throw new Error(`exit:${c}`);
  }) as never);
}
afterEach(() => vi.restoreAllMocks());

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "fhapply-"));
const names = async (dir: string) => (await fs.readdir(dir)).sort();

describe("parseSpec", () => {
  it("returns a well-formed spec", () => {
    const spec = gpioSpec();
    expect(parseSpec(spec)).toBe(spec);
  });

  it("rejects a non-object", () => {
    expect(() => parseSpec("nope")).toThrow(/JSON object/);
    expect(() => parseSpec([1, 2])).toThrow(/JSON object/);
  });

  it("rejects a spec missing the engine workflow", () => {
    expect(() => parseSpec({ schemaVersion: 1, id: "d", status: "active", components: {} })).toThrow(/engine\.config\.workflow/);
  });
});

describe("renderConfigFromSpec", () => {
  it("wires no provider/web-search env when the workflow uses neither", () => {
    const cfg = renderConfigFromSpec(gpioSpec());
    expect(cfg.llmKeys).toEqual({});
    expect(cfg.webSearch).toBeUndefined();
  });
});

describe("applyCommand", () => {
  it("re-renders engine-config, compose and spec into the spec's directory", async () => {
    silence();
    const dir = await tmp();
    const specPath = path.join(dir, "deployment-spec.json");
    await fs.writeFile(specPath, JSON.stringify(gpioSpec()));

    await applyCommand(specPath, []);

    expect(await names(dir)).toEqual(["deployment-spec.json", "docker-compose.yml", "engine-config.json"].sort());
    const compose = await fs.readFile(path.join(dir, "docker-compose.yml"), "utf-8");
    expect(compose).toContain("image: fh-engine:0.4.2");
    expect(compose).toContain('- "/dev/gpiochip0:/dev/gpiochip0"');
    expect(compose).toContain("./engine-config.json:/etc/foresthub/engine-config.json:ro");
    const engineConfig = JSON.parse(await fs.readFile(path.join(dir, "engine-config.json"), "utf-8"));
    expect(engineConfig.workflow.schemaVersion).toBeGreaterThanOrEqual(1);
    expect(Object.keys(engineConfig.manifest.gpios)).toHaveLength(1);
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("writes to --output when given, leaving the source dir alone", async () => {
    silence();
    const dir = await tmp();
    const outDir = path.join(dir, "out");
    const specPath = path.join(dir, "deployment-spec.json");
    await fs.writeFile(specPath, JSON.stringify(gpioSpec()));

    await applyCommand(specPath, ["--output", outDir]);

    expect(await names(outDir)).toEqual(["deployment-spec.json", "docker-compose.yml", "engine-config.json"].sort());
    expect(await names(dir)).toContain("out");
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("exits on a missing spec file", async () => {
    const exit = trapExit();
    await expect(applyCommand("/no/such/spec.json", [])).rejects.toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("exits on a spec missing the engine workflow", async () => {
    const dir = await tmp();
    const specPath = path.join(dir, "spec.json");
    await fs.writeFile(specPath, JSON.stringify({ schemaVersion: 1, id: "d", status: "active", components: {} }));
    trapExit();
    await expect(applyCommand(specPath, [])).rejects.toThrow("exit:1");
    await fs.rm(dir, { recursive: true, force: true });
  });
});
