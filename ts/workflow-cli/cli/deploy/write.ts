// Output writer: turns the config into actual files on disk. This is the
// "write" step. The generators produce strings; this puts them in the bundle.

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";
import { buildDeployArtifacts } from "./builders";
import { composeYaml, envFile, readme } from "./generate";
import type { DeployConfig, DeployRequirements } from "./types";

export async function writeOutput(
  workflow: ApiWorkflow,
  cfg: DeployConfig,
  req: DeployRequirements,
): Promise<string[]> {
  // Build the three wire-files in memory first: a completeness failure
  // (assertDeployable) throws here, before anything is written to disk.
  const artifacts = buildDeployArtifacts(req, cfg);

  const dir = path.resolve(process.cwd(), cfg.outputDir);

  if (existsSync(dir)) {
    const contents = await fs.readdir(dir);
    if (contents.length > 0) {
      if (!cfg.force) {
        process.stderr.write(`output dir not empty: ${dir} (use --force to overwrite)\n`);
        process.exit(1);
      }
      // force=true: wipe + recreate so stale files (old fh-engine.tar, stray
      // .env from a prior run, ...) don't end up in the new bundle.
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
    }
  } else {
    await fs.mkdir(dir, { recursive: true });
  }

  const written: string[] = [];
  // secret=true -> mode 0o600 (.env, external_resources.json carry keys/passwords).
  const emit = async (name: string, content: string, secret = false): Promise<void> => {
    const out = path.join(dir, name);
    const opts = secret ? { encoding: "utf-8" as const, mode: 0o600 } : { encoding: "utf-8" as const };
    await fs.writeFile(out, content, opts);
    written.push(out);
  };
  const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

  await emit("workflow.json", json(workflow));
  await emit("docker-compose.yml", composeYaml(cfg, req));
  await emit(".env", envFile(cfg), true);
  await emit("README.md", readme(cfg, req));

  // Deploy wire-files — only the ones this workflow needs. The engine skips an
  // unset *_FILE env var, so an absent file is correct, not a gap.
  const hasHardware = req.hardwareChannels.length > 0;
  const hasExternal = req.mqttChannels.length > 0 || req.customModels.length > 0;
  if (hasHardware) await emit("device_manifest.json", json(artifacts.deviceManifest));
  if (hasExternal) await emit("external_resources.json", json(artifacts.externalResources), true);
  if (hasHardware || hasExternal) await emit("deployment_mapping.json", json(artifacts.deploymentMapping));

  // On-device models bind-mount ./models/ — create it so the operator has a place
  // to drop the GGUF file(s) and docker doesn't create it root-owned on first up.
  if (Object.values(cfg.models).some((b) => b.location === "device")) {
    await fs.mkdir(path.join(dir, "models"), { recursive: true });
  }

  return written;
}
