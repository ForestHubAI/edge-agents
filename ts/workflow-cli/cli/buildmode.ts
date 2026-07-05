// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Which `open` strategy this build uses. The esbuild CLI bundle injects
// __FH_BUILD_MODE__="static" via --define; under tsx (in-repo dev) the
// identifier is never defined, so `typeof` reads "undefined" and we default to
// "dev". A bare `const` default would be wrong here — esbuild's --define won't
// override a locally-bound identifier, so the flag has to come in as an ambient
// global that only the bundle defines.
declare const __FH_BUILD_MODE__: "dev" | "static" | undefined;

export type OpenMode = "dev" | "static";

const BUILD_MODE: OpenMode = typeof __FH_BUILD_MODE__ === "string" ? __FH_BUILD_MODE__ : "dev";

/**
 * Pick the `open` strategy. DEV spawns the Vite dev server (HMR, source — the
 * in-repo path); STATIC serves the prebuilt SPA over a plain HTTP server (the
 * installed path). Precedence: explicit `--static`/`--dev` flag → `FH_BUILDER_MODE`
 * env → build-time default. The env override lets you exercise the installed
 * path from inside the repo.
 */
export function resolveOpenMode(argv: string[], env: NodeJS.ProcessEnv): OpenMode {
  if (argv.includes("--static")) return "static";
  if (argv.includes("--dev")) return "dev";
  if (env.FH_BUILDER_MODE === "static" || env.FH_BUILDER_MODE === "dev") return env.FH_BUILDER_MODE;
  return BUILD_MODE;
}
