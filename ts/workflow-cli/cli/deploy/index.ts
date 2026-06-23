// `fh-workflow deploy <workflow.json> [flags]`
//
// Generates a self-contained Engine deployment bundle (workflow.json,
// docker-compose.yml, .env, README.md) from a workflow. The bundle is always
// STANDALONE: the engine boots the workflow from workflow.json and runs
// autonomously.
//
// Flow: read workflow -> inspect (derive requirements) -> prompt (fill values)
// -> write (emit files). Flags pre-fill any value; whatever is missing is asked
// interactively.

import { migrate } from "@foresthubai/workflow-core";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";
import { deserialize } from "@foresthubai/workflow-core/workflow";
import { deriveRequirements, buildDeploymentSpec } from "@foresthubai/workflow-core/deploy";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { promptMissing, promptComponentPaths } from "./prompts";
import { parseDeployComponents, readComponentJson, resolveComponentEnv } from "./components";
import { writeOutput } from "./write";
import { slugify } from "./generate";
import { ALL_PROVIDERS, familyMismatches, ggufNameError, hardwareConflicts, logLevelSchema, unknownIds, valuesFileSchema } from "./types";
import type { DeployConfig, DeployRequirements, LogLevel, Provider, RawFlags } from "./types";

// Resolved component images the spec pins. The engine is currently built locally
// (bare name → local daemon, renderer's pull_policy never); the llama sidecar is a
// pinned upstream tag. When engine images are published to a registry, this gains
// a registry host and the renderer's pull_policy flips to missing.
const ENGINE_IMAGE = "fh-engine:latest";
const LLAMA_SERVER_IMAGE = "ghcr.io/ggml-org/llama.cpp:server-b8589";

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: fh-workflow deploy <workflow.json> [flags]

Generates a self-contained, standalone Engine deployment bundle (workflow.json,
docker-compose.yml, .env, README.md). The engine boots the workflow and runs
autonomously. Missing values are filled in interactively, or supplied via
--values when there is no terminal.

LLM provider keys (set one for each catalog model an Agent uses):
${ALL_PROVIDERS.map((p) => `  --${p}-key KEY`).join("\n")}

Custom components (extra containers to run alongside the engine):
  --component DIR                 folder with a component.json (repeatable)

Output:
  --output DIR                    default: ./<workflow-name>-bundle
  --force                         overwrite existing DIR
  --log-level LEVEL               ${logLevelSchema.options.join("|")} (default: info)

Automation (no terminal — e.g. a Claude Code skill or CI):
  --values FILE                   JSON partial deploy config supplying the answers
                                  (chmod 600 — may hold secrets). Without a terminal,
                                  any missing required value exits non-zero.

  --help, -h                      this message
`;

// parseFlags / partialFromFlags / loadValues / missingRequired / configFromPartial
// are exported for unit testing; deployCommand is their only runtime caller.
export function parseFlags(args: string[]): RawFlags {
  // One --<provider>-key string flag per provider, derived from ALL_PROVIDERS.
  const keyOptions = Object.fromEntries(ALL_PROVIDERS.map((p) => [`${p}-key`, { type: "string" as const }]));
  const { values } = parseArgs({
    args,
    options: {
      ...keyOptions,
      output: { type: "string" },
      "log-level": { type: "string" },
      values: { type: "string" },
      component: { type: "string", multiple: true },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  // Collect the set provider keys back into one record, dropping the unset ones.
  // The --<provider>-key flags are built dynamically, so parseArgs doesn't know
  // them by name — reach them through an untyped view and narrow with typeof.
  const llmKeys: Partial<Record<Provider, string>> = {};
  for (const p of ALL_PROVIDERS) {
    const key = (values as Record<string, unknown>)[`${p}-key`];
    if (typeof key === "string") llmKeys[p] = key;
  }
  return {
    llmKeys,
    output: values.output,
    logLevel: values["log-level"],
    values: values.values,
    component: values.component ?? [],
    force: values.force ?? false,
    help: values.help ?? false,
  };
}

// Merge a --values file (the base) with explicit flags (which win). Provider
// keys merge per provider; the scalar flags override only when actually set.
// An invalid --log-level exits 1 — loud like a bad values file, not silent.
export function partialFromFlags(flags: RawFlags, fileValues: Partial<DeployConfig>): Partial<DeployConfig> {
  const llmKeys: Partial<Record<Provider, string>> = { ...(fileValues.llmKeys ?? {}), ...flags.llmKeys };

  // Same schema the values file is checked against — one list of valid levels.
  let flagLogLevel: LogLevel | undefined;
  if (flags.logLevel !== undefined) {
    const checked = logLevelSchema.safeParse(flags.logLevel);
    if (!checked.success) {
      process.stderr.write(`Invalid --log-level "${flags.logLevel}" — expected ${logLevelSchema.options.join("|")}.\n`);
      process.exit(1);
    }
    flagLogLevel = checked.data;
  }

  return {
    ...fileValues,
    llmKeys,
    ...(flags.output !== undefined ? { outputDir: flags.output } : {}),
    ...(flags.force ? { force: true } : {}),
    ...(flagLogLevel ? { logLevel: flagLogLevel } : {}),
  };
}

// Load a --values file: a partial DeployConfig as JSON. Never logged (may carry
// secrets). Exits 1 on a missing file, malformed JSON, or content that doesn't
// match valuesFileSchema (wrong types, unknown keys) — listing every problem as
// a `path: reason` line so a non-interactive caller can fix the file.
export async function loadValues(source: string): Promise<Partial<DeployConfig>> {
  const abs = path.resolve(process.cwd(), source);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf-8");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      process.stderr.write(`Values file not found: ${abs}\n`);
      process.exit(1);
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`Invalid JSON in values file: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    process.stderr.write("Values file must be a JSON object (a partial deploy config).\n");
    process.exit(1);
  }
  const checked = valuesFileSchema.safeParse(parsed);
  if (!checked.success) {
    process.stderr.write("Invalid values file (not a partial deploy config):\n");
    for (const issue of checked.error.issues) {
      const at = issue.path.length > 0 ? issue.path.join(".") : "(top level)";
      process.stderr.write(`  - ${at}: ${issue.message}\n`);
    }
    process.exit(1);
  }
  return checked.data;
}

// Required values that have no default and can only come from the operator,
// plus consistency problems (address conflicts, family-mismatched fields) —
// used to fail fast (exit 1) when there is no terminal to prompt on.
export function missingRequired(req: DeployRequirements, p: Partial<DeployConfig>): string[] {
  const missing: string[] = [];
  for (const ch of req.hardwareChannels) {
    const b = p.hardware?.[ch.id];
    if (!b || !b.chipOrDevice) {
      missing.push(`hardware "${ch.id}": device path`);
      continue;
    }
    if (ch.addressable && b.index === undefined) missing.push(`hardware "${ch.id}": index`);
  }
  missing.push(...hardwareConflicts(req.hardwareChannels, p.hardware ?? {}));
  missing.push(...familyMismatches(req.hardwareChannels, p.hardware ?? {}));
  for (const ch of req.mqttChannels) {
    if (!p.mqtt?.[ch.id]?.brokerUrl) missing.push(`mqtt "${ch.id}": broker URL`);
  }
  for (const m of req.customModels) {
    const b = p.models?.[m.id];
    if (b?.location === "device") {
      const err = ggufNameError(b.modelFile);
      if (err) missing.push(`model "${m.id}": ${err}`);
    } else if (!b?.url) {
      missing.push(`model "${m.id}": endpoint URL`);
    }
  }
  if (req.hasWebSearch && !p.webSearch?.apiKey) missing.push("web search: API key");
  missing.push(...unknownIds(req, p));
  return missing;
}

// Assemble a complete config straight from the partial, filling optional
// defaults. Used on the non-interactive path (no prompts).
export function configFromPartial(p: Partial<DeployConfig>, outputDirDefault: string): DeployConfig {
  return {
    llmKeys: p.llmKeys ?? {},
    outputDir: p.outputDir ?? outputDirDefault,
    force: p.force ?? false,
    logLevel: p.logLevel ?? "info",
    hardware: p.hardware ?? {},
    mqtt: p.mqtt ?? {},
    models: p.models ?? {},
    webSearch: p.webSearch,
  };
}

// ---------------------------------------------------------------------------
// Entry point — wired into cli/index.ts
// ---------------------------------------------------------------------------

export async function deployCommand(workflowPath: string | undefined, args: string[]): Promise<void> {
  // --help or missing positional → print USAGE
  if (!workflowPath || workflowPath === "--help" || workflowPath === "-h") {
    process.stdout.write(USAGE);
    process.exit(workflowPath ? 0 : 1);
  }

  // Resolve and read the workflow
  const abs = path.resolve(process.cwd(), workflowPath);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
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

  let workflow: ApiWorkflow;
  try {
    workflow = migrate(parsed);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // All operator values come from flags or interactive prompts — never from
  // process.env. CI/CD users who want env-based config pass them explicitly:
  //   --anthropic-key "$ANTHROPIC_API_KEY"
  const flags = parseFlags(args);
  if (flags.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  // Deserialize to the domain model, then derive requirements from it. The
  // resolver (buildDeploymentSpec) is domain-based; deserialize also re-validates
  // node/channel shapes, failing here rather than mid-build.
  let domain;
  try {
    domain = deserialize(workflow);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
  const req = deriveRequirements(domain);

  // Custom models are handled per model in the prompts (on-device sidecar vs. an
  // endpoint the operator runs) and explained accurately in the generated README —
  // no blanket pre-prompt note here, which could only guess at that choice.

  // A standalone engine has no retriever, so a Retriever node can never resolve
  // and the engine fails at build. Refuse rather than emit a dead bundle.
  if (req.hasRetriever) {
    process.stderr.write(
      "error: workflow references a Retriever node (RAG).\n" +
        "       A standalone engine has no retriever, so the node cannot resolve and the\n" +
        "       engine fails at build. Remove the Retriever node to deploy standalone.\n",
    );
    process.exit(1);
  }

  // Build the partial config: an optional --values file (the base) merged with
  // explicit flags. No file -> an empty base, everything comes from prompts.
  const workflowName = path.basename(abs, path.extname(abs));
  const outputDirDefault = `./${slugify(workflowName)}-bundle`;
  const fileValues = flags.values ? await loadValues(flags.values) : {};
  const partial = partialFromFlags(flags, fileValues);

  // Interactive at a terminal; otherwise (skill / CI) fail fast on any missing
  // required value — the values must all arrive via --values.
  let cfg: DeployConfig;
  if (process.stdin.isTTY) {
    cfg = await promptMissing(partial, outputDirDefault, req, workflowName);
  } else {
    const missing = missingRequired(req, partial);
    if (missing.length > 0) {
      process.stderr.write("error: no interactive terminal and the supplied values are missing or invalid:\n");
      for (const m of missing) process.stderr.write(`  - ${m}\n`);
      process.stderr.write("Supply them in a --values <file.json> (a partial deploy config). See --help.\n");
      process.exit(1);
    }
    cfg = configFromPartial(partial, outputDirDefault);
  }

  // Custom components: operator-authored containers merged in beside the engine.
  // Paths come from --component (any context) plus, at a terminal, an interactive
  // loop. Each folder's component.json is validated against the contract.
  const componentDirs = [...flags.component];
  if (process.stdin.isTTY) componentDirs.push(...(await promptComponentPaths()));
  let customComponents;
  try {
    const raw = await Promise.all(
      componentDirs.map(async (dir) => ({
        source: path.join(dir, "component.json"),
        data: await readComponentJson(dir),
      })),
    );
    customComponents = parseDeployComponents(raw);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // Per custom component, turn its <name>.env.example into <name>.env text (empty
  // values prompted at a terminal, stubbed otherwise). componentDirs and
  // customComponents are index-aligned — both built from the same path list.
  const componentEnv: Record<string, string> = {};
  for (let i = 0; i < customComponents.length; i++) {
    const c = customComponents[i];
    const dir = componentDirs[i];
    if (!c || dir === undefined) continue;
    const text = await resolveComponentEnv(dir, c.name, { interactive: process.stdin.isTTY });
    if (text !== null) componentEnv[c.name] = text;
  }

  // Resolve the deployment spec. buildDeploymentSpec re-validates completeness
  // and throws on a gap — turn that into a clean exit rather than a stack trace.
  let built;
  try {
    built = buildDeploymentSpec(
      domain,
      cfg,
      {
        id: slugify(workflowName),
        status: "active",
        engineImage: ENGINE_IMAGE,
        llamaServerImage: LLAMA_SERVER_IMAGE,
      },
      customComponents,
    );
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // Write the bundle. Secrets (resourceSecrets) go to .env, never the spec.
  let files: string[];
  try {
    files = await writeOutput(built.spec, built.resourceSecrets, cfg, req, componentEnv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const absOut = path.resolve(process.cwd(), cfg.outputDir);
  process.stdout.write(`\n✓ Deployment bundle written to ${absOut}\n`);
  for (const f of files) {
    process.stdout.write(`  - ${path.relative(process.cwd(), f)}\n`);
  }
  process.stdout.write(`\nNext: build the image (\`docker build -t fh-engine:latest go/\`), then follow README.md.\n`);
}
