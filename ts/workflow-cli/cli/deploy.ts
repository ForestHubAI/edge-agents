// `fh-workflow deploy <workflow.json> [flags]`
//
// Generates a self-contained Engine deployment bundle (workflow.json,
// docker-compose.yml, .env, README.md) from a workflow. Hybrid UX: missing
// values come from flags or interactive prompts. Skill callers should always
// pass --non-interactive plus every needed value as an explicit --flag.

import { migrate } from "@foresthubai/workflow-core";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";
import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Mode = "standalone" | "cloud";

type Provider = "anthropic" | "openai" | "gemini" | "mistral";

const ALL_PROVIDERS: Provider[] = ["anthropic", "openai", "gemini", "mistral"];

type LogLevel = "debug" | "info" | "warn" | "error";

// What the Inspector derives from the workflow content alone. Pure-functional
// output — no file paths, no operator input.
interface BundleRequirements {
  // True when at least one Agent references a model NOT declared in
  // workflow.models — i.e. a catalog/cloud model that needs a provider API key
  // (or backend routing in cloud mode).
  hasProviderModel: boolean;
  // True when at least one Agent references a model declared in workflow.models
  // — a custom/self-hosted model served by a llama-server sidecar (Stage 3).
  hasCustomModel: boolean;
  hasRetriever: boolean;
  // Recommendation only — the operator can still pick the other mode.
  modeRecommendation: "standalone-ok" | "cloud-required";
}

// What the prompts + flags collect from the operator. Drives all three
// generators (composeYaml / envFile / readme).
interface BundleConfig {
  mode: Mode;
  backendUrl?: string;
  engineSecret?: string;
  publicAddress?: string;
  llmKeys: Partial<Record<Provider, string>>;
  outputDir: string;
  force: boolean;
  logLevel: LogLevel;
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

// Exported for testing purposes only.
//
// The only thing the CLI can reliably derive from a model id is whether it is
// custom or not. The engine resolves model -> provider by exact-match against
// each provider's static catalog (llmproxy), NOT by prefix — so the CLI cannot
// (and must not try to) infer the concrete provider. A model id declared in
// workflow.models is a custom/self-hosted model (Stage 3 llama-server sidecar);
// any other id is a catalog/cloud model that needs a provider API key.
export function inspect(workflow: ApiWorkflow): BundleRequirements {
  const customModelIds = new Set((workflow.models ?? []).map((m) => m.id));
  let hasProviderModel = false;
  let hasCustomModel = false;
  let hasRetriever = false;

  // Functions carry their own `nodes` array — an Agent inside a function counts
  // too. Iterate top-level and function bodies together.
  const allNodes = [...workflow.nodes, ...(workflow.functions ?? []).flatMap((f) => f.nodes ?? [])];

  for (const node of allNodes) {
    if (node.type === "Agent") {
      const modelId = node.arguments.model;
      if (!modelId) continue;
      if (customModelIds.has(modelId)) hasCustomModel = true;
      else hasProviderModel = true;
    } else if (node.type === "Retriever") {
      hasRetriever = true;
    }
  }

  return {
    hasProviderModel,
    hasCustomModel,
    hasRetriever,
    modeRecommendation: hasRetriever ? "cloud-required" : "standalone-ok",
  };
}

// ---------------------------------------------------------------------------
// Generators — pure functions producing one output file each
//
// composeYaml writes ${VAR:-} interpolations exclusively. Operator values
// live in .env, never inlined here, so the same compose file works across
// every (.env, controller) pair.
// ---------------------------------------------------------------------------

// Exported for testing purposes only.
export function composeYaml(cfg: BundleConfig): string {
  const providerLines = ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]))
    .map((p) => `      ${p.toUpperCase()}_API_KEY: \${${p.toUpperCase()}_API_KEY:-}`)
    .join("\n");

  return `# ForestHub engine — minimal Compose deployment.
# See README.md for the build/transfer/run workflow.
# See .env for operator-set values.

services:
  engine:
    image: fh-engine:latest
    pull_policy: never
    container_name: fh-engine
    restart: unless-stopped
    environment:
      # Operator-set — see .env for documentation.
      ENGINE_SECRET: \${ENGINE_SECRET:-}
      FH_BACKEND_URL: \${FH_BACKEND_URL:-}
      ENGINE_PUBLIC_ADDRESS: \${ENGINE_PUBLIC_ADDRESS:-}
      ENGINE_LOG_LEVEL: \${ENGINE_LOG_LEVEL:-info}${providerLines ? "\n" + providerLines : ""}
      # Container-internal paths.
      ENGINE_CONFIG_FILE: /etc/foresthub/workflow.json
      ENGINE_MEMORY_DIR: /var/forest/memory
    volumes:
      - ./workflow.json:/etc/foresthub/workflow.json:ro
      - engine-memory:/var/forest/memory

volumes:
  engine-memory:
`;
}

// Exported for testing purposes only.
export function envFile(cfg: BundleConfig): string {
  const localProviders = ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]));
  const providerSection =
    localProviders.length === 0
      ? ""
      : `\n# ----- LLM provider keys -----
# Each key here = that provider runs locally with your API key.
${localProviders.map((p) => `${p.toUpperCase()}_API_KEY=${cfg.llmKeys[p] ?? ""}`).join("\n")}
`;

  return `# ForestHub engine — operator configuration.
# Auto-generated by \`fh-workflow deploy\`. \`docker compose\` auto-loads this file.
# Secret values: chmod 600 .env after editing.

# ----- Mode -----
# Both empty   = STANDALONE  (no backend; workflow runs autonomously)
# Both set     = CLOUD       (engine registers, heartbeats, accepts /deploy)
#
# FH_BACKEND_URL and ENGINE_SECRET come from your fh-backend operator.
FH_BACKEND_URL=${cfg.backendUrl ?? ""}
ENGINE_SECRET=${cfg.engineSecret ?? ""}

# Optional: only set if this engine is reachable from the backend (LAN/public).
# Leave empty if the controller isn't reachable from the backend — heartbeats
# still keep liveness fresh.
ENGINE_PUBLIC_ADDRESS=${cfg.publicAddress ?? ""}
${providerSection}
# ----- Runtime -----
ENGINE_LOG_LEVEL=${cfg.logLevel}     # debug | info | warn | error
`;
}

// Exported for testing purposes only.
export function readme(cfg: BundleConfig): string {
  const modeBlock =
    cfg.mode === "standalone"
      ? `This bundle deploys in **standalone** mode — the engine boots the workflow
from \`workflow.json\` and runs autonomously without a backend.`
      : `This bundle deploys in **cloud** mode — the engine registers with
\`${cfg.backendUrl ?? ""}\` and heartbeats every 30 seconds.`;

  const localProviders = ALL_PROVIDERS.filter((p) => Boolean(cfg.llmKeys[p]));
  const providerBlock =
    localProviders.length === 0
      ? "_No local API keys set._ See the routing table below for what that means at runtime."
      : localProviders.map((p) => `- **${p}** — runs locally (your API key)`).join("\n");

  return `# ForestHub engine — deployment bundle

Generated by \`fh-workflow deploy\`. This directory contains everything needed
to run one engine instance on an edge controller:

- \`docker-compose.yml\` — deployment template
- \`workflow.json\` — the workflow graph the engine executes
- \`.env\` — operator configuration (already filled in, \`chmod 600\` it)
- \`fh-engine.tar\` — image tarball (you build this in step 1 below)

## Mode

${modeBlock}

## LLM provider routing

${providerBlock}

For each provider the engine picks one of two paths at boot, based on whether
an API key is present in \`.env\`:

| Local key in \`.env\` | Path                                    | Who pays          | Tokens visible in backend UI |
| --------------------- | --------------------------------------- | ----------------- | ---------------------------- |
| Yes                   | engine → provider directly              | Your API key      | No                           |
| No (cloud mode)       | engine → backend \`/llm/chat\` → provider | Backend's API key | Yes (via MonitoringService)  |
| No (standalone)       | (unsupported — node fails at build)     | —                 | —                            |

## 1. Build the image (on the dev machine)

From a clone of the edge-agents repo:

\`\`\`bash
cd go
# Native build (matches the dev machine's arch)
docker build -t fh-engine:latest .

# Cross-build for ARM controller from x86 dev box (or vice-versa)
docker buildx build --platform linux/arm64 -t fh-engine:latest --load .
docker buildx build --platform linux/amd64 -t fh-engine:latest --load .
\`\`\`

## 2. Review the generated \`.env\`

\`\`\`bash
chmod 600 .env
\`\`\`

The wizard already filled in your operator values. Double-check before
transferring — secrets are in plaintext.

## 3. Save the image and transfer to the controller

\`\`\`bash
export CONTROLLER_USER=<your-user>
export CONTROLLER_ADDR=<controller-ip-or-hostname>

cd go
docker save fh-engine:latest -o ../path/to/this/bundle/fh-engine.tar

ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'mkdir -p ~/fh-engine'

cd path/to/this/bundle
scp fh-engine.tar docker-compose.yml workflow.json .env \\
    $CONTROLLER_USER@$CONTROLLER_ADDR:~/fh-engine/
\`\`\`

## 4. Run (on the controller)

\`\`\`bash
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker load -i fh-engine.tar'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose up -d'
ssh $CONTROLLER_USER@$CONTROLLER_ADDR 'cd ~/fh-engine && docker compose logs -f engine'
\`\`\`
`;
}

// Exported for testing purposes only.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Flag parsing + env fallbacks
// ---------------------------------------------------------------------------

const USAGE = `Usage: fh-workflow deploy <workflow.json> [flags]

Generates a self-contained Engine deployment bundle (workflow.json,
docker-compose.yml, .env, README.md). Missing values are filled
interactively unless --non-interactive is passed.

Mode:
  --mode standalone|cloud         default: derived from workflow
  --backend-url URL               required for cloud
  --engine-secret SECRET          required for cloud
  --public-address ADDR           optional; leave empty if the controller
                                  isn't reachable from the backend

LLM provider keys (optional, otherwise backend-routed):
  --anthropic-key KEY
  --openai-key KEY
  --gemini-key KEY
  --mistral-key KEY

Output:
  --output DIR                    default: ./<workflow-name>-bundle
  --force                         overwrite existing DIR
  --log-level LEVEL               debug|info|warn|error (default: info)

UX:
  --non-interactive               no prompts; missing required → exit 1
  --help, -h                      this message
`;

interface RawFlags {
  mode?: string;
  backendUrl?: string;
  engineSecret?: string;
  publicAddress?: string;
  anthropicKey?: string;
  openaiKey?: string;
  geminiKey?: string;
  mistralKey?: string;
  output?: string;
  logLevel?: string;
  force: boolean;
  nonInteractive: boolean;
  help: boolean;
}

function parseFlags(args: string[]): RawFlags {
  const { values } = parseArgs({
    args,
    options: {
      mode: { type: "string" },
      "backend-url": { type: "string" },
      "engine-secret": { type: "string" },
      "public-address": { type: "string" },
      "anthropic-key": { type: "string" },
      "openai-key": { type: "string" },
      "gemini-key": { type: "string" },
      "mistral-key": { type: "string" },
      output: { type: "string" },
      "log-level": { type: "string" },
      force: { type: "boolean", default: false },
      "non-interactive": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return {
    mode: values.mode,
    backendUrl: values["backend-url"],
    engineSecret: values["engine-secret"],
    publicAddress: values["public-address"],
    anthropicKey: values["anthropic-key"],
    openaiKey: values["openai-key"],
    geminiKey: values["gemini-key"],
    mistralKey: values["mistral-key"],
    output: values.output,
    logLevel: values["log-level"],
    force: values.force ?? false,
    nonInteractive: values["non-interactive"] ?? false,
    help: values.help ?? false,
  };
}

function partialFromFlags(flags: RawFlags): { partial: Partial<BundleConfig>; outputDirDefault: (name: string) => string } {
  const llmKeys: Partial<Record<Provider, string>> = {};
  if (flags.anthropicKey) llmKeys.anthropic = flags.anthropicKey;
  if (flags.openaiKey) llmKeys.openai = flags.openaiKey;
  if (flags.geminiKey) llmKeys.gemini = flags.geminiKey;
  if (flags.mistralKey) llmKeys.mistral = flags.mistralKey;

  const mode: Mode | undefined = flags.mode === "standalone" || flags.mode === "cloud" ? flags.mode : undefined;

  const logLevel: LogLevel =
    flags.logLevel === "debug" || flags.logLevel === "info" || flags.logLevel === "warn" || flags.logLevel === "error"
      ? flags.logLevel
      : "info";

  return {
    partial: {
      mode,
      backendUrl: flags.backendUrl,
      engineSecret: flags.engineSecret,
      publicAddress: flags.publicAddress,
      llmKeys,
      outputDir: flags.output,
      force: flags.force,
      logLevel,
    },
    outputDirDefault: (name) => `./${slugify(name)}-bundle`,
  };
}

// ---------------------------------------------------------------------------
// Interactive prompt layer (only entered when TTY + not --non-interactive)
// ---------------------------------------------------------------------------

async function promptMissing(
  partial: Partial<BundleConfig>,
  outputDirDefault: string,
  req: BundleRequirements,
  nonInteractive: boolean,
): Promise<BundleConfig> {
  const needFlag = (msg: string): never => {
    process.stderr.write(`missing required: ${msg}\n`);
    process.exit(1);
  };

  // Mode
  let mode: Mode;
  if (partial.mode) {
    mode = partial.mode;
  } else if (nonInteractive) {
    // needFlag returns `never` (process.exit); assigning satisfies definite
    // assignment so TS sees `mode` set on every reachable path.
    mode = needFlag("--mode (standalone|cloud)");
  } else {
    mode = await select<Mode>({
      message: "Deployment mode",
      choices: [
        { value: "standalone", name: "standalone — no backend, workflow runs autonomously" },
        { value: "cloud", name: "cloud — engine registers + heartbeats" },
      ],
      default: req.modeRecommendation === "cloud-required" ? "cloud" : "standalone",
    });
    if (mode === "standalone" && req.hasRetriever) {
      const ok = await confirm({
        message: "Workflow has a Retriever node — it needs a backend. Continue anyway?",
        default: false,
      });
      if (!ok) process.exit(1);
    }
  }

  // Cloud-mode required fields
  let backendUrl = partial.backendUrl;
  let engineSecret = partial.engineSecret;
  let publicAddress = partial.publicAddress;
  if (mode === "cloud") {
    if (!backendUrl) {
      if (nonInteractive) needFlag("--backend-url");
      backendUrl = await input({
        message: "Backend URL (e.g. https://fh-backend-368736749905.europe-west1.run.app)",
        validate: (s) => /^https?:\/\//.test(s) || "must start with http:// or https://",
      });
    }
    if (!engineSecret) {
      if (nonInteractive) needFlag("--engine-secret");
      engineSecret = await password({ message: "Engine secret", mask: "*" });
    }
    if (publicAddress === undefined && !nonInteractive) {
      publicAddress = await input({
        message: "Engine public address (leave empty if the controller isn't reachable from the backend)",
        default: "",
      });
    }
  }

  // LLM keys: single multi-select over all four providers, skipped entirely
  // when the workflow has no catalog/cloud model. Custom-only workflows (every
  // Agent model declared in workflow.models) need no provider key.
  const llmKeys: Partial<Record<Provider, string>> = { ...(partial.llmKeys ?? {}) };
  if (!nonInteractive && req.hasProviderModel) {
    const selectedProviders = await checkbox<Provider>({
      message: "Which providers should run with a local API key?",
      choices: ALL_PROVIDERS.map((p) => ({ value: p, name: p })),
    });
    // Drop keys for providers the operator unchecked, even if they came in
    // via a CLI flag — the multi-select is authoritative.
    for (const p of ALL_PROVIDERS) {
      if (!selectedProviders.includes(p)) delete llmKeys[p];
    }
    // Prompt for keys for selected providers that don't have one yet.
    for (const provider of selectedProviders) {
      if (llmKeys[provider]) continue;
      const key = await password({ message: `${provider} API key`, mask: "*" });
      if (key) llmKeys[provider] = key;
    }
  }

  // Output directory — with collision handling. If the dir exists and is
  // non-empty, the interactive flow lets the operator overwrite, pick another
  // dir, or abort. The non-interactive flow fails with "use --force".
  let outputDir: string;
  let force = partial.force ?? false;
  {
    let candidate = partial.outputDir;
    while (true) {
      if (!candidate) {
        candidate = nonInteractive ? outputDirDefault : await input({ message: "Output directory", default: outputDirDefault });
      }
      const resolved = path.resolve(process.cwd(), candidate);
      const exists = existsSync(resolved);
      const nonEmpty = exists && (await fs.readdir(resolved)).length > 0;
      if (!nonEmpty || force) {
        outputDir = candidate;
        break;
      }
      if (nonInteractive) {
        process.stderr.write(`output dir not empty: ${resolved} (use --force to overwrite)\n`);
        process.exit(1);
      }
      const action = await select<"overwrite" | "another" | "abort">({
        message: `${resolved} is not empty.`,
        choices: [
          { value: "overwrite", name: "overwrite the existing files" },
          { value: "another", name: "choose a different directory" },
          { value: "abort", name: "abort" },
        ],
      });
      if (action === "abort") process.exit(0);
      if (action === "overwrite") {
        force = true;
        outputDir = candidate;
        break;
      }
      // action === "another": clear and re-prompt
      candidate = undefined;
    }
  }

  return {
    mode,
    backendUrl,
    engineSecret,
    publicAddress: publicAddress || undefined,
    llmKeys,
    outputDir,
    force,
    logLevel: partial.logLevel ?? "info",
  };
}

// ---------------------------------------------------------------------------
// Output writer — produces the 4 bundle files
// ---------------------------------------------------------------------------

async function writeOutput(workflow: ApiWorkflow, cfg: BundleConfig): Promise<string[]> {
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

  const workflowOut = path.join(dir, "workflow.json");
  const composeOut = path.join(dir, "docker-compose.yml");
  const envOut = path.join(dir, ".env");
  const readmeOut = path.join(dir, "README.md");

  await fs.writeFile(workflowOut, JSON.stringify(workflow, null, 2) + "\n", "utf-8");
  await fs.writeFile(composeOut, composeYaml(cfg), "utf-8");
  await fs.writeFile(envOut, envFile(cfg), { encoding: "utf-8", mode: 0o600 });
  await fs.writeFile(readmeOut, readme(cfg), "utf-8");

  return [workflowOut, composeOut, envOut, readmeOut];
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

  // Self-hosted models need a llama-server sidecar + SELFHOSTED_CONFIG_FILE that
  // this bundle does not generate yet (Stage 3). Warn rather than emit a bundle
  // that silently fails to resolve the model at deploy.
  if (req.hasCustomModel) {
    process.stderr.write(
      "warning: workflow references a custom/self-hosted model (declared in workflow.models).\n" +
        "         The engine needs a llama-server sidecar + SELFHOSTED_CONFIG_FILE to serve it,\n" +
        "         which this bundle does not generate yet — the model will fail to resolve at deploy.\n",
    );
  }

  // Build partial config and compute output dir default
  const workflowName = path.basename(abs, path.extname(abs));
  const { partial, outputDirDefault } = partialFromFlags(flags);

  // Prompt or fail for missing values
  const cfg = await promptMissing(partial, outputDirDefault(workflowName), req, flags.nonInteractive);

  // Write the bundle
  const files = await writeOutput(workflow, cfg);

  const absOut = path.resolve(process.cwd(), cfg.outputDir);
  process.stdout.write(`\n✓ Deployment bundle written to ${absOut}\n`);
  for (const f of files) {
    process.stdout.write(`  - ${path.relative(process.cwd(), f)}\n`);
  }
  process.stdout.write(`\nNext: build the image (\`docker build -t fh-engine:latest go/\`), then follow README.md.\n`);
}
