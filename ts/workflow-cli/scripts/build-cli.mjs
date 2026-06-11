// Bundles the fh-workflow CLI into a single self-contained Node ESM file so the
// published package installs with zero runtime @foresthubai/* deps (no GitHub
// Packages auth) and no tsx. The SPA is built separately by `vite build`.
import { build } from "esbuild";
import { copyFile, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsRoot = path.resolve(appRoot, "..");
const repoRoot = path.resolve(tsRoot, "..");
const outfile = path.join(appRoot, "dist-cli", "cli.js");

// Resolve @foresthubai/workflow-core (and subpaths) to its SOURCE, mirroring the
// tsconfig `paths` / vite alias. The CLI then bundles from source like the SPA
// does, so this build never depends on workflow-core's dist/ being present.
const workflowCoreSource = {
  name: "workflow-core-source",
  setup(b) {
    b.onResolve({ filter: /^@foresthubai\/workflow-core(\/.*)?$/ }, (args) => {
      const sub = args.path.slice("@foresthubai/workflow-core".length);
      const rel = sub === "" ? "src/index.ts" : `src/${sub.slice(1)}/index.ts`;
      return { path: path.join(tsRoot, "workflow-core", rel) };
    });
  },
};

await build({
  entryPoints: [path.join(appRoot, "cli", "index.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "bundle", // inline everything, incl. workflow-core (via the plugin) + jsep/ajv/js-yaml
  external: ["vite"], // the DEV branch only spawns vite; never import it into the bundle
  define: { __FH_BUILD_MODE__: '"static"' },
  loader: { ".json": "json" },
  plugins: [workflowCoreSource],
  banner: {
    // Shebang + a require() shim: the bundle is ESM but inlines CJS deps (ajv).
    js: '#!/usr/bin/env node\nimport{createRequire as ___cr}from"node:module";const require=___cr(import.meta.url);',
  },
  logLevel: "info",
});

// Ship the contract next to the bundle so `check-schema` works when installed
// (check-schema.ts prefers these siblings over the repo-relative source path).
// workflow.yaml cross-references llmproxy.yaml, so both must travel together.
for (const contractFile of ["workflow.yaml", "llmproxy.yaml"]) {
  await copyFile(
    path.join(repoRoot, "contract", contractFile),
    path.join(appRoot, "dist-cli", contractFile),
  );
}

// Executable bit for POSIX; harmless on Windows (the npm bin shim handles exec).
await chmod(outfile, 0o755);

process.stdout.write(`Built ${path.relative(appRoot, outfile)} + dist-cli contract files\n`);
