// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Output writer: turns the resolved spec into actual files on disk. This is the
// "write" step. The generators produce strings; this puts them in the bundle.
// The spec arrives already validated (buildDeploymentSpec threw on any gap).

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { composeYaml, configFileName, envFile, readme, secretsFileName } from "./generate";
import type { DeployConfig, DeployRequirements } from "./types";
import type { DeploymentSchemas } from "./api";
import { onnxComponentServiceName } from "./spec";
import type { ComponentSecrets } from "./spec";

type DeploymentSpec = DeploymentSchemas["DeploymentSpec"];

export async function writeOutput(
  spec: DeploymentSpec,
  componentSecrets: Record<string, ComponentSecrets>,
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
      // force=true: wipe + recreate so stale files (an old engine.tar, a stray
      // .env from a prior run, ...) don't end up in the new bundle.
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
    }
  } else {
    await fs.mkdir(dir, { recursive: true });
  }

  const written: string[] = [];
  // secret=true -> mode 0o600. The secret-bearing files: engine.env carries the
  // provider keys + web-search key, a custom component's <name>.env may carry its
  // own, and <name>-secrets.json is the resource-credential doc. The
  // <name>-config.json files and deployment-spec.json are secret-free by
  // construction — safe to share.
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
  // One secret doc per component that needs one, keyed by resource id — the
  // resolver already split them so each component holds only its own credentials
  // (the engine never receives a camera's stream password). Delivered as mounted
  // files, never via env or the spec. Absent -> no file, no mount (anonymous
  // broker / keyless endpoint / unauthenticated camera).
  const secretDocs = componentSecrets;

  await emit("deployment-spec.json", json(spec));
  await emit("docker-compose.yml", composeYaml(spec, secretDocs));
  await emit("engine.env", envFile(cfg), true);
  for (const [name, doc] of Object.entries(secretDocs)) {
    await emit(secretsFileName(name), json(doc), true);
  }
  await emit("README.md", readme(spec, cfg, req.hasProviderModel, Object.keys(secretDocs).length > 0));

  // One <name>.env per custom component that ships a <name>.env.example —
  // secret-bearing, so 0600 like engine.env.
  for (const [name, text] of Object.entries(componentEnv)) {
    await emit(`${name}.env`, text, true);
  }

  // Pre-create each component's workspace bind-mount dir (./workspaces/<container>/)
  // so the operator has a place to drop model GGUFs and docker doesn't create them
  // root-owned on first `up`. Sources are relative bind mounts in the spec; the
  // leading "./" is stripped to join under the bundle dir.
  const workspaceSources = new Set(
    spec.components.flatMap((c) => (c.volumes ?? []).map((v) => v.split(":")[0] ?? "").filter((src) => src.startsWith("./workspaces/"))),
  );
  for (const src of workspaceSources) {
    await fs.mkdir(path.join(dir, src), { recursive: true });
  }

  // Each on-device ML model's repository sub-folder — named by model, not a bind
  // mount, so the loop above misses it. The operator drops model.onnx here.
  const mlRepoDir = path.join("workspaces", onnxComponentServiceName());
  for (const b of Object.values(cfg.mlModels)) {
    if (b.location === "device") await fs.mkdir(path.join(dir, mlRepoDir, b.model), { recursive: true });
  }

  return written;
}
