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
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { inspect } from "./inspect";
import { promptMissing } from "./prompts";
import { writeOutput } from "./write";
import { slugify } from "./generate";
import type { DeployConfig, DeployRequirements, LogLevel, Provider, RawFlags } from "./types";

// ---------------------------------------------------------------------------
// Flag parsing
// ---------------------------------------------------------------------------

const USAGE = `Usage: fh-workflow deploy <workflow.json> [flags]

Generates a self-contained, standalone Engine deployment bundle (workflow.json,
docker-compose.yml, .env, README.md). The engine boots the workflow and runs
autonomously. Missing values are filled in interactively, or supplied via
--values when there is no terminal.

LLM provider keys (set one for each catalog model an Agent uses):
  --anthropic-key KEY
  --openai-key KEY
  --gemini-key KEY
  --mistral-key KEY

Output:
  --output DIR                    default: ./<workflow-name>-bundle
  --force                         overwrite existing DIR
  --log-level LEVEL               debug|info|warn|error (default: info)

Automation (no terminal — e.g. a Claude Code skill or CI):
  --values FILE                   JSON partial deploy config supplying the answers
                                  (chmod 600 — may hold secrets). Without a terminal,
                                  any missing required value exits non-zero.

  --help, -h                      this message
`;

// parseFlags / partialFromFlags / loadValues / missingRequired / configFromPartial
// are exported for unit testing; deployCommand is their only runtime caller.
export function parseFlags(args: string[]): RawFlags {
  const { values } = parseArgs({
    args,
    options: {
      "anthropic-key": { type: "string" },
      "openai-key": { type: "string" },
      "gemini-key": { type: "string" },
      "mistral-key": { type: "string" },
      output: { type: "string" },
      "log-level": { type: "string" },
      values: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    anthropicKey: values["anthropic-key"],
    openaiKey: values["openai-key"],
    geminiKey: values["gemini-key"],
    mistralKey: values["mistral-key"],
    output: values.output,
    logLevel: values["log-level"],
    values: values.values,
    force: values.force ?? false,
    help: values.help ?? false,
  };
}

// Merge a --values file (the base) with explicit flags (which win). Provider
// keys merge per provider; the scalar flags override only when actually set.
export function partialFromFlags(flags: RawFlags, fileValues: Partial<DeployConfig>): Partial<DeployConfig> {
  const llmKeys: Partial<Record<Provider, string>> = { ...(fileValues.llmKeys ?? {}) };
  if (flags.anthropicKey) llmKeys.anthropic = flags.anthropicKey;
  if (flags.openaiKey) llmKeys.openai = flags.openaiKey;
  if (flags.geminiKey) llmKeys.gemini = flags.geminiKey;
  if (flags.mistralKey) llmKeys.mistral = flags.mistralKey;

  const flagLogLevel: LogLevel | undefined =
    flags.logLevel === "debug" || flags.logLevel === "info" || flags.logLevel === "warn" || flags.logLevel === "error"
      ? flags.logLevel
      : undefined;

  return {
    ...fileValues,
    llmKeys,
    ...(flags.output !== undefined ? { outputDir: flags.output } : {}),
    ...(flags.force ? { force: true } : {}),
    ...(flagLogLevel ? { logLevel: flagLogLevel } : {}),
  };
}

// Load a --values file: a partial DeployConfig as JSON. Never logged (may carry
// secrets). Exits 1 on a missing file or malformed JSON.
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
  return parsed as Partial<DeployConfig>;
}

// Required values that have no default and can only come from the operator —
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
  for (const ch of req.mqttChannels) {
    if (!p.mqtt?.[ch.id]?.brokerUrl) missing.push(`mqtt "${ch.id}": broker URL`);
  }
  for (const m of req.customModels) {
    const b = p.models?.[m.id];
    if (b?.location === "device") {
      if (!b.modelFile) missing.push(`model "${m.id}": model filename`);
    } else if (!b?.url) {
      missing.push(`model "${m.id}": endpoint URL`);
    }
  }
  if (req.hasWebSearch && !p.webSearch?.apiKey) missing.push("web search: API key");
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

  // Inspect workflow to derive requirements
  const req = inspect(workflow);

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
    cfg = await promptMissing(partial, outputDirDefault, req);
  } else {
    const missing = missingRequired(req, partial);
    if (missing.length > 0) {
      process.stderr.write("error: no interactive terminal and required values are missing:\n");
      for (const m of missing) process.stderr.write(`  - ${m}\n`);
      process.stderr.write("Supply them in a --values <file.json> (a partial deploy config). See --help.\n");
      process.exit(1);
    }
    cfg = configFromPartial(partial, outputDirDefault);
  }

  // Write the bundle. buildDeployArtifacts (inside writeOutput) re-validates
  // completeness and throws on a gap — turn that into a clean exit rather than
  // letting the raw error surface as a stack trace.
  let files: string[];
  try {
    files = await writeOutput(workflow, cfg, req);
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
