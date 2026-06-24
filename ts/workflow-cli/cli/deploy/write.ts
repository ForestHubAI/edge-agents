// Output writer: turns the resolved spec into actual files on disk. This is the
// "write" step. The generators produce strings; this puts them in the bundle.
// The spec arrives already validated (buildDeploymentSpec threw on any gap).

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { composeYaml, configFileName, envFile, readme } from "./generate";
import type { DeployConfig, DeployRequirements } from "./types";
import type { DeploymentSchemas } from "@foresthubai/workflow-core/api";
import type { ResourceSecrets } from "@foresthubai/workflow-core/deploy";

type DeploymentSpec = DeploymentSchemas["DeploymentSpec"];

export async function writeOutput(
  spec: DeploymentSpec,
  resourceSecrets: ResourceSecrets,
  cfg: DeployConfig,
  req: DeployRequirements,
  componentEnv: Record<string, string> = {},
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
  // secret=true -> mode 0o600. The env files are secret-bearing: engine.env
  // carries the provider keys, web-search key, and FH_RESOURCE_SECRETS, and a
  // custom component's <name>.env may carry its own. The <name>-config.json files
  // and deployment-spec.json are secret-free by construction — safe to share.
  const emit = async (name: string, content: string, secret = false): Promise<void> => {
    const out = path.join(dir, name);
    const opts = secret ? { encoding: "utf-8" as const, mode: 0o600 } : { encoding: "utf-8" as const };
    await fs.writeFile(out, content, opts);
    written.push(out);
  };
  const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

  // One <name>-config.json per component carrying a config blob (the engine's boot
  // file today) — bind-mounted read-only by the renderer, secret-free. The full
  // resolved spec is the deployment record.
  for (const c of spec.components) {
    if (c.config !== undefined) await emit(configFileName(c.name), json(c.config));
  }
  await emit("deployment-spec.json", json(spec));
  await emit("docker-compose.yml", composeYaml(spec));
  await emit("engine.env", envFile(cfg, resourceSecrets), true);
  await emit("README.md", readme(spec, cfg, req.hasProviderModel));

  // One <name>.env per custom component that ships a <name>.env.example —
  // secret-bearing, so 0600 like engine.env.
  for (const [name, text] of Object.entries(componentEnv)) {
    await emit(`${name}.env`, text, true);
  }

  // On-device models bind-mount ./models/ — create it so the operator has a place
  // to drop the GGUF file(s) and docker doesn't create it root-owned on first up.
  if (Object.values(cfg.models).some((b) => b.location === "device")) {
    await fs.mkdir(path.join(dir, "models"), { recursive: true });
  }

  return written;
}
