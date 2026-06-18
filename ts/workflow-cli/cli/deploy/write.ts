// Output writer: turns the resolved spec into actual files on disk. This is the
// "write" step. The generators produce strings; this puts them in the bundle.
// The spec arrives already validated (buildDeploymentSpec threw on any gap).

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { composeYaml, envFile, readme } from "./generate";
import type { DeployConfig, DeployRequirements } from "./types";
import type { DeploymentSchemas } from "@foresthubai/workflow-core/api";
import type { ResourceSecrets } from "@foresthubai/workflow-core/deploy";

type DeploymentSpec = DeploymentSchemas["DeploymentSpec"];

export async function writeOutput(
  spec: DeploymentSpec,
  resourceSecrets: ResourceSecrets,
  cfg: DeployConfig,
  req: DeployRequirements,
): Promise<string[]> {
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
  // secret=true -> mode 0o600. Only .env is secret-bearing now: it carries the
  // provider keys and FH_RESOURCE_SECRETS (broker passwords / endpoint keys).
  // engine-config.json and deployment-spec.json are secret-free by construction —
  // safe to read, commit, or share.
  const emit = async (name: string, content: string, secret = false): Promise<void> => {
    const out = path.join(dir, name);
    const opts = secret ? { encoding: "utf-8" as const, mode: 0o600 } : { encoding: "utf-8" as const };
    await fs.writeFile(out, content, opts);
    written.push(out);
  };
  const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

  const engine = spec.components.engine;
  if (!engine) throw new Error("spec has no engine component"); // buildDeploymentSpec always sets it

  // The engine's single boot file (workflow + bindings + manifest, unified) and
  // the full resolved spec (record + re-apply source) — both secret-free.
  await emit("engine-config.json", json(engine.config));
  await emit("deployment-spec.json", json(spec));
  await emit("docker-compose.yml", composeYaml(spec, cfg));
  await emit(".env", envFile(cfg, resourceSecrets), true);
  await emit("README.md", readme(spec, cfg, req.hasProviderModel));

  // On-device models bind-mount ./models/ — create it so the operator has a place
  // to drop the GGUF file(s) and docker doesn't create it root-owned on first up.
  if (Object.values(cfg.models).some((b) => b.location === "device")) {
    await fs.mkdir(path.join(dir, "models"), { recursive: true });
  }

  return written;
}
