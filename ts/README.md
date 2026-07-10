# ForestHub — TypeScript workspace

This directory is an **npm workspace** (the JS/TS half of the polyglot `edge-agents`
repo; the Go binding and the OpenAPI contract live in sibling `../go` and
`../contract`). It contains three packages that build on each other:

| Package | Role | Depends on | Public entry |
| --- | --- | --- | --- |
| [`@foresthubai/workflow-core`](./workflow-core) | Headless workflow model: types, (de)serialization, pure validator. **No React, no DOM.** Runs in Node, a CLI, or the browser. | — | `import … from "@foresthubai/workflow-core"` (+ subpaths) |
| [`@foresthubai/workflow-builder`](./workflow-builder) | Reusable React component: the visual canvas/editor. Imports core for types + validation. | `workflow-core` (dep), `react` (peer) | `import { WorkflowBuilder } from "@foresthubai/workflow-builder"` |
| [`@foresthubai/workflow-cli`](./workflow-cli) | The `fh-workflow` CLI + the reference host SPA it serves. Self-contained: bundles the builder + core. **Published to npm.** | both + ajv/js-yaml (bundled at build) | `npx @foresthubai/workflow-cli` → `fh-workflow` |

Layering is strict and one-directional: `workflow-core ← workflow-builder ← workflow-cli`.
Core never imports the builder; the builder never imports the cli.

```
ts/
├─ package.json            # workspace root: lists members, aggregate scripts
├─ tsconfig.base.json      # shared compiler options + path mappings (see below)
├─ workflow-core/          # @foresthubai/workflow-core
├─ workflow-builder/       # @foresthubai/workflow-builder
├─ workflow-cli/           # @foresthubai/workflow-cli  (fh-workflow CLI + bundled SPA)
└─ node_modules/           # hoisted deps + @foresthubai/* symlinks (gitignored)
```

## Resolution model: source in-repo, `dist` for consumers

This is the one thing to understand about the setup. There are two worlds:

| | `@foresthubai/*` resolves to | How |
| --- | --- | --- |
| **Inside this repo** (typecheck, Vite dev, the CLI) | each package's **`src/`** | tsc `paths` (in `tsconfig.base.json`) + Vite `alias` (in `workflow-cli/vite.config.ts`) |
| **An external consumer** (your frontend, `npm i …`) | each package's **`dist/`** | the package's `"exports"` map in its `package.json` |

In-repo, everything is **source** — contributors get types and HMR with no build
step, and the two tools (tsc + Vite) are kept in agreement on purpose. `dist/` is
produced **only for publishing**; nothing in the repo imports it. The `paths`/alias
are scoped to `ts/` and have zero effect on an installed package, so the two worlds
never collide.

`tsconfig.base.json` (extended by `workflow-core` and `workflow-builder`):

```jsonc
"paths": {
  "@foresthubai/workflow-core":   ["./workflow-core/src/index.ts"],
  "@foresthubai/workflow-core/*": ["./workflow-core/src/*/index.ts"],
  "@foresthubai/workflow-builder":["./workflow-builder/src/index.ts"]
}
// No `baseUrl` (deprecated). With paths and no baseUrl, values must be
// relative; `extends` anchors them to this file's dir (ts/).
```

## Public API surface (`exports`)

What a consumer is allowed to import is defined by each package's `"exports"` —
not by its file layout.

- **`workflow-core`** exposes a root entry plus namespaced subpaths
  (`/node`, `/edge`, `/channel`, `/memory`, `/parameter`, `/variable`,
  `/expression`, `/workflow`, `/diagnostics`). The subpaths exist on purpose:
  `serialize`/`deserialize` and `DataType` mean different things per domain, so
  they're namespaced rather than flattened into one barrel.
- **`workflow-builder`** exposes a single root entry (`WorkflowBuilder`, its
  contract types, `ValidationDialog`). Its design-system CSS lives at
  `src/styles/index.css` and must be imported once by the host.

## Scripts

The real command lives in the package it concerns; the **root scripts forward or
aggregate** — they are not duplicates.

**Root (`ts/`):**

| Script | Does |
| --- | --- |
| `npm run typecheck` | `tsc -b workflow-core workflow-builder` — type-checks the libraries (source-to-source via `paths`). |
| `npm run lint` | `eslint .` |
| `npm run build` | Runs each package's own `build` (`--workspaces --if-present`). |
| `npm run generate` | Forwards to `workflow-core`'s `generate`. |

**Per package:**

| Package | Script | Does |
| --- | --- | --- |
| `workflow-core` | `build` | `tsc -b` → `dist/` |
| | `generate` | Regenerates `src/api/workflow.ts` from `../../contract/workflow.yaml` (committed; CI diffs it to catch drift). |
| | `test` | `vitest run` |
| `workflow-builder` | `build` | `tsc -b` → `dist/` |
| `workflow-cli` | `dev` | `vite` dev server |
| | `open` / `check-schema` / `validate` / `deploy` / `cli` | the `fh-workflow` CLI (see below) |
| | `build:all` | `vite build` (SPA) + esbuild (CLI bundle) → the publishable artifacts |

Run a package's script directly with `-w`, e.g. `npm run test -w @foresthubai/workflow-core`.

## Local development

```bash
npm install                 # from ts/ — installs + links all three packages
npm run typecheck           # check the libraries
```

Run the builder in a browser via the reference app / CLI (from `ts/workflow-cli`):

```bash
npm run dev                          # blank canvas, HMR
npm run open -- sample.json          # open a workflow; Save writes back to that file
npm run check-schema -- sample.json  # structural schema check against the contract
npm run validate -- sample.json      # headless semantic validation, non-zero exit on errors
# or directly: node cli/fh-workflow.mjs <open|check-schema|validate|deploy> <file>
```

`open` spawns the Vite dev server in-repo (DEV mode); the published CLI serves the
prebuilt SPA from a plain HTTP server instead (STATIC mode). Force the installed path
locally with `FH_BUILDER_MODE=static npm run open -- sample.json` after `npm run build:all`.
Because the app resolves the libraries to **source**, editing `workflow-core` or
`workflow-builder` hot-reloads the canvas instantly.

> Prefer running the builder from the **repo root** — `npm run open -- my.workflow.json`
> after a one-time root `npm install`. It bootstraps `ts/` for you and needs no `cd` into
> the package. See the root [README](../README.md#build-from-source). The commands here
> are the package-internal equivalents.

## Releasing (`workflow-core` + `workflow-builder` + `workflow-cli`)

All three packages release **in lockstep** with one command from `ts/`:

```bash
npm run release -- 0.2.0   # bumps all three, pins builder→core, builds, publishes
```

All three publish to **public npm** (npmjs.com) under the `@foresthubai` scope (each
package's own `publishConfig` sets the registry + public access). The CLI bundles core +
builder at build time, so it carries no runtime `@foresthubai/*` dependency. Full
flow, registry/auth setup, and the Go-module tag live in [`../RELEASING.md`](../RELEASING.md).

## Conventions

- `dist/` and all `node_modules/` are gitignored; never commit build output.
- `src/api/workflow.ts` (core's contract types) **is** committed and regenerated
  via `npm run generate`; CI diffs it to keep TS and Go in lockstep.
- Tests (`*.test.ts`) are excluded from the library `build` (`tsc -b`); run them
  with `vitest`.
