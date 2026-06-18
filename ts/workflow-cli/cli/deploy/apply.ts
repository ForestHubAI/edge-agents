// `fh-workflow apply <deployment-spec.json> [--output DIR]`
//
// Re-renders an already-resolved DeploymentSpec to its deployable bundle
// artifacts (engine-config.json, docker-compose.yml) without re-running the
// workflow→spec wizard. The OSS re-apply / reconcile path: edit a field in the
// spec (bump a component version, change a binding) and re-render; then
// `docker compose up -d` recreates only the changed containers.
//
// Secrets are NOT managed here. Provider API keys + the web-search key live in
// .env (device env), never in the spec — an existing .env is left untouched. The
// spec only decides which env interpolations compose wires.

import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { deserialize } from "@foresthubai/workflow-core/workflow";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";
import { deriveRequirements } from "@foresthubai/workflow-core/deploy";
import type { DeploymentSchemas } from "@foresthubai/workflow-core/api";
import { composeYaml } from "./generate";
import { ALL_PROVIDERS } from "./types";
import type { DeployConfig, Provider } from "./types";

type DeploymentSpec = DeploymentSchemas["DeploymentSpec"];

const USAGE = `Usage: fh-workflow apply <deployment-spec.json> [--output DIR]

Re-renders a resolved deployment spec to its bundle artifacts (engine-config.json,
docker-compose.yml) — the OSS re-apply path. Edit the spec (bump a component
version, tweak a binding) and re-run; then 'docker compose up -d' recreates only
the changed containers.

Secrets are not managed here: provider API keys live in .env (device env), never
in the spec — your existing .env is left untouched.

  --output DIR   where to write (default: the spec file's directory)
  --help, -h     this message
`;

// Light structural validation — DeploymentSpec is generated TS types (no zod), so
// check the load-bearing fields and let deserialize validate the embedded
// workflow. Exported for unit testing.
export function parseSpec(raw: unknown): DeploymentSpec {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("deployment spec must be a JSON object");
  }
  const spec = raw as Partial<DeploymentSpec>;
  if (!spec.components?.engine?.config?.workflow) {
    throw new Error("deployment spec has no components.engine.config.workflow");
  }
  return raw as DeploymentSpec;
}

// The synthetic render config composeYaml needs. It reads only provider presence
// and web-search presence from the config — both derived here from the spec's
// embedded workflow. All catalog-provider slots are wired when the workflow uses
// any catalog model (the operator fills the keys it actually needs in .env);
// nothing device-specific is invented. Exported for unit testing.
export function renderConfigFromSpec(spec: DeploymentSpec): DeployConfig {
  const workflow = spec.components.engine?.config.workflow;
  if (!workflow) throw new Error("deployment spec has no engine workflow");
  const req = deriveRequirements(deserialize(workflow as ApiWorkflow));
  const llmKeys: Partial<Record<Provider, string>> = {};
  if (req.hasProviderModel) for (const p of ALL_PROVIDERS) llmKeys[p] = "x";
  return {
    llmKeys,
    outputDir: "",
    force: false,
    logLevel: "info",
    hardware: {},
    mqtt: {},
    models: {},
    webSearch: req.hasWebSearch ? { provider: "brave", apiKey: "x" } : undefined,
  };
}

export async function applyCommand(specPath: string | undefined, args: string[]): Promise<void> {
  if (!specPath || specPath === "--help" || specPath === "-h") {
    process.stdout.write(USAGE);
    process.exit(specPath ? 0 : 1);
  }

  const { values } = parseArgs({
    args,
    options: { output: { type: "string" }, help: { type: "boolean", short: "h", default: false } },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  const abs = path.resolve(process.cwd(), specPath);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(`File not found: ${abs}\n`);
      process.exit(1);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  let spec: DeploymentSpec;
  let renderCfg: DeployConfig;
  try {
    spec = parseSpec(parsed);
    // Derives the env wiring AND re-validates the embedded workflow (deserialize
    // throws on a malformed graph) before anything is written.
    renderCfg = renderConfigFromSpec(spec);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const engine = spec.components.engine;
  if (!engine) {
    process.stderr.write("deployment spec has no engine component\n");
    process.exit(1);
  }

  const outDir = values.output ? path.resolve(process.cwd(), values.output) : path.dirname(abs);
  await fs.mkdir(outDir, { recursive: true });

  const written: string[] = [];
  const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";
  // Targeted overwrite — apply re-renders the deployable artifacts in place and
  // leaves .env / README / models untouched. engine-config + spec are secret-
  // bearing (externalResources creds), so 0o600.
  const emit = async (name: string, content: string, secret = false): Promise<void> => {
    const out = path.join(outDir, name);
    const opts = secret ? { encoding: "utf-8" as const, mode: 0o600 } : { encoding: "utf-8" as const };
    await fs.writeFile(out, content, opts);
    written.push(out);
  };

  await emit("engine-config.json", json(engine.config), true);
  await emit("docker-compose.yml", composeYaml(spec, renderCfg));
  await emit("deployment-spec.json", json(spec), true);

  process.stdout.write(`\n✓ Rendered deployment spec to ${outDir}\n`);
  for (const f of written) process.stdout.write(`  - ${path.relative(process.cwd(), f)}\n`);
  process.stdout.write(
    `\nNext: \`docker compose up -d\` in that directory — only containers whose config changed recreate.\n`,
  );
}
