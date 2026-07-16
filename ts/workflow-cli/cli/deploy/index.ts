// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// `fh-workflow deploy <workflow.json> [flags]`
//
// Generates a self-contained Engine deployment bundle (docker-compose.yml,
// engine-config.json, engine.env, README.md) from a workflow. The bundle is
// always STANDALONE: the engine boots the workflow from engine-config.json and
// runs autonomously.
//
// Flow: read workflow -> inspect (derive requirements) -> prompt (fill values)
// -> write (emit files). Flags pre-fill any value; whatever is missing is asked
// interactively.

import { migrate } from "@foresthubai/workflow-core";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";
import { deserialize } from "@foresthubai/workflow-core/workflow";
import { deriveRequirements } from "./requirements";
import { buildDeploymentSpec } from "./spec";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { promptMissing } from "./prompts";
import { parseDeployComponents, readComponentJson, resolveComponentEnv } from "./components";
import type { DeployComponent, LoadedComponent } from "./components";
import { writeOutput } from "./write";
import { slugify } from "./generate";
import {
  PROVIDER_IDS,
  providerFlag,
  familyMismatches,
  ggufNameError,
  hardwareConflicts,
  logLevelSchema,
  mlModelNameError,
  unknownIds,
  valuesFileSchema,
} from "./types";
import type { DeployConfig, DeployRequirements, LogLevel, RawFlags } from "./types";
import { MODEL_CATALOG } from "../../src/catalog";
import type { DeploymentInputs } from "./inputs";
import { ENGINE_COMPONENT_NAME, ML_COMPONENT_NAME, CAMERA_COMPONENT_NAME } from "@foresthubai/workflow-core/deploy";

// Resolved component images the spec pins. The self-built ones are built locally
// (image repo = the component's canonical identity → local daemon, renderer's
// pull_policy never), mirroring the paid path's `ghcr.io/foresthubai/<identity>`; the
// llama component is a pinned upstream tag. When these images are published to a
// registry, they gain a registry host and the renderer's pull_policy flips to missing.
const ENGINE_IMAGE = `${ENGINE_COMPONENT_NAME}:latest`;
const LLAMA_SERVER_IMAGE = "ghcr.io/ggml-org/llama.cpp:server-b8589";
const ML_COMPONENT_IMAGE = `${ML_COMPONENT_NAME}:latest`;
const CAMERA_COMPONENT_IMAGE = `${CAMERA_COMPONENT_NAME}:latest`;

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: fh-workflow deploy <workflow.json> [flags]

Generates a self-contained, standalone Engine deployment bundle (docker-compose.yml,
engine-config.json, engine.env, README.md). The engine boots the workflow and runs
autonomously. Missing values are filled in interactively, or supplied via
--values when there is no terminal.

LLM provider keys (set one for each provider your Agents use):
${PROVIDER_IDS.map((id) => `  --${providerFlag(id)}-key KEY`).join("\n")}

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
  // One --<provider>-key string flag per catalog provider (flag = id lowercased).
  const keyOptions = Object.fromEntries(PROVIDER_IDS.map((id) => [`${providerFlag(id)}-key`, { type: "string" as const }]));
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
  const llmKeys: Record<string, string> = {};
  for (const id of PROVIDER_IDS) {
    const key = (values as Record<string, unknown>)[`${providerFlag(id)}-key`];
    if (typeof key === "string") llmKeys[id] = key;
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
  const llmKeys: Record<string, string> = { ...(fileValues.llmKeys ?? {}), ...flags.llmKeys };

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
  for (const m of req.customLLMModels) {
    const b = p.llmModels?.[m.id];
    if (b?.location === "device") {
      const err = ggufNameError(b.modelFile);
      if (err) missing.push(`model "${m.id}": ${err}`);
    } else if (!b?.url) {
      missing.push(`model "${m.id}": endpoint URL`);
    }
  }
  for (const m of req.customMLModels) {
    const b = p.mlModels?.[m.id];
    const nameErr = mlModelNameError(b?.model);
    if (nameErr) missing.push(`model "${m.id}": ${nameErr}`);
    if (b?.location !== "device" && !b?.url) {
      missing.push(`model "${m.id}": on-device or endpoint URL`);
    }
  }
  for (const ch of req.cameraChannels) {
    const b = p.cameras?.[ch.id];
    if (!b) {
      missing.push(`camera "${ch.id}": how the camera is reached`);
    } else if (b.kind === "v4l2" && !b.device) {
      missing.push(`camera "${ch.id}": device node`);
    } else if ((b.kind === "rtsp" || b.kind === "http") && !b.url) {
      missing.push(`camera "${ch.id}": stream URL`);
    } else if (b.kind === "raw" && !b.pipeline) {
      missing.push(`camera "${ch.id}": capture-source fragment`);
    }
  }
  if (req.hasWebSearch && !p.webSearch?.apiKey) missing.push("web search: API key");
  for (const prov of req.catalogProviders) {
    if (!p.llmKeys?.[prov.id]) missing.push(`provider "${prov.id}": API key`);
  }
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
    llmModels: p.llmModels ?? {},
    mlModels: p.mlModels ?? {},
    cameras: p.cameras ?? {},
    webSearch: p.webSearch,
  };
}

// Read and validate the --component folders once, up front, so a bad component.json
// fails before any prompting (in either mode). Identical folders are deduped
// (passing one twice is accidental); two distinct folders declaring the same name
// collide — surfaced here rather than late at spec assembly. Each component is
// paired with its folder for the later <name>.env step.
async function loadFlagComponents(dirs: string[]): Promise<LoadedComponent[]> {
  const uniqueDirs = [...new Set(dirs.map((d) => path.resolve(process.cwd(), d)))];
  const entries = await Promise.all(
    uniqueDirs.map(async (dir) => ({ source: path.join(dir, "component.json"), data: await readComponentJson(dir), dir })),
  );
  parseDeployComponents(entries); // validates all at once; throws on any gap
  const seen = new Set<string>();
  const loaded: LoadedComponent[] = [];
  for (const e of entries) {
    const component = e.data as DeployComponent;
    if (seen.has(component.name)) {
      throw new Error(`duplicate component name "${component.name}" (two --component folders declare it)`);
    }
    seen.add(component.name);
    loaded.push({ component, dir: e.dir });
  }
  return loaded;
}

// Turn each component's <name>.env.example into <name>.env text. The non-interactive
// path's env step (stubs empty values); the interactive path resolves env inline as
// each component is added.
async function resolveComponentsEnv(loaded: LoadedComponent[]): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const { component, dir } of loaded) {
    const text = await resolveComponentEnv(dir, component.name, { interactive: false });
    if (text !== null) env[component.name] = text;
  }
  return env;
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
  const req = deriveRequirements(domain, MODEL_CATALOG);

  // Custom models are handled per model in the prompts (on-device component vs. an
  // endpoint the operator runs) and explained accurately in the generated README —
  // no blanket pre-prompt note here, which could only guess at that choice.

  // A standalone engine has no retriever, so a declared VectorDatabase can never
  // be bound and the engine fails at build. assertDeployable refuses this too, but
  // only after input collection — refuse up front rather than prompt for bindings
  // the operator can never make deployable.
  if (req.ragMemories.length > 0) {
    const ids = req.ragMemories.map((m) => `"${m.id}"`).join(", ");
    process.stderr.write(
      `error: workflow declares a vector database (RAG): ${ids}.\n` +
        "       A standalone engine has no retriever, so the collection cannot be bound and\n" +
        "       the engine fails at build. Remove the vector database to deploy standalone.\n",
    );
    process.exit(1);
  }

  // Build the partial config: an optional --values file (the base) merged with
  // explicit flags. No file -> an empty base, everything comes from prompts.
  const workflowName = path.basename(abs, path.extname(abs));
  const outputDirDefault = `./${slugify(workflowName)}-bundle`;
  const fileValues = flags.values ? await loadValues(flags.values) : {};
  const partial = partialFromFlags(flags, fileValues);

  // Custom components passed via --component are read and validated up front, so a
  // bad component.json fails before any prompting (in either mode).
  let preloaded: LoadedComponent[];
  try {
    preloaded = await loadFlagComponents(flags.component);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // Interactive at a terminal; otherwise (skill / CI) fail fast on any missing
  // required value — the values must all arrive via --values. Both modes produce
  // the same three results: the operator config, the custom components, their env.
  let cfg: DeployConfig;
  let customComponents: DeployComponent[];
  let componentEnv: Record<string, string>;
  if (process.stdin.isTTY) {
    ({ config: cfg, customComponents, componentEnv } = await promptMissing(
      partial,
      outputDirDefault,
      req,
      workflowName,
      preloaded,
    ));
  } else {
    const missing = missingRequired(req, partial);
    if (missing.length > 0) {
      process.stderr.write("error: no interactive terminal and the supplied values are missing or invalid:\n");
      for (const m of missing) process.stderr.write(`  - ${m}\n`);
      process.stderr.write("Supply them in a --values <file.json> (a partial deploy config). See --help.\n");
      process.exit(1);
    }
    cfg = configFromPartial(partial, outputDirDefault);
    customComponents = preloaded.map((c) => c.component);
    componentEnv = await resolveComponentsEnv(preloaded);
  }

  // Resolve the deployment spec. buildDeploymentSpec re-validates completeness
  // and throws on a gap — turn that into a clean exit rather than a stack trace.
  let built;
  try {
    // OSS path: every catalog provider runs locally with the operator's key. The
    // key rides in secrets.json (resolver → resourceSecrets), never .env. Backend
    // routing (backendLlm) is a paid-path concern and is never emitted here.
    const inputs: DeploymentInputs = {
      hardware: cfg.hardware,
      mqtt: cfg.mqtt,
      llmModels: cfg.llmModels,
      mlModels: cfg.mlModels,
      cameras: cfg.cameras,
      providers: Object.fromEntries(
        Object.entries(cfg.llmKeys).map(([id, apiKey]) => [id, { routing: "local" as const, apiKey }]),
      ),
    };
    built = buildDeploymentSpec(
      domain,
      inputs,
      {
        id: slugify(workflowName),
        engineImage: ENGINE_IMAGE,
        llamaServerImage: LLAMA_SERVER_IMAGE,
        mlComponentImage: ML_COMPONENT_IMAGE,
        cameraComponentImage: CAMERA_COMPONENT_IMAGE,
      },
      customComponents,
      MODEL_CATALOG,
    );
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  // Write the bundle. Secrets (resourceSecrets) ride in a mounted secret document,
  // never in .env or the spec.
  let files: string[];
  try {
    files = await writeOutput(built.spec, built.componentSecrets, cfg, req, componentEnv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const absOut = path.resolve(process.cwd(), cfg.outputDir);
  process.stdout.write(`\n✓ Deployment bundle written to ${absOut}\n`);
  for (const f of files) {
    process.stdout.write(`  - ${path.relative(process.cwd(), f)}\n`);
  }
  process.stdout.write(`\nNext: build the image (\`docker build -f go/Dockerfile.engine -t fh-engine:latest go\`), then follow README.md.\n`);
}
