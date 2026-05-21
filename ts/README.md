# ForestHub — TypeScript workspace

This directory is an **npm workspace** (the JS/TS half of the polyglot `fh-core`
repo; the Go binding and the OpenAPI contract live in sibling `../go` and
`../contract`). It contains three packages that build on each other:

| Package | Role | Depends on | Public entry |
| --- | --- | --- | --- |
| [`@foresthub/workflow-core`](./workflow-core) | Headless workflow model: types, (de)serialization, pure validator. **No React, no DOM.** Runs in Node, a CLI, or the browser. | — | `import … from "@foresthub/workflow-core"` (+ subpaths) |
| [`@foresthub/workflow-builder`](./workflow-builder) | Reusable React component: the visual canvas/editor. Imports core for types + validation. | `workflow-core` (dep), `react` (peer) | `import { WorkflowBuilder } from "@foresthub/workflow-builder"` |
| [`@foresthub/app`](./app) | Reference host SPA + the `fh-builder` CLI. Embeds the builder for local dev/testing. **Not published.** | both, `react` | — (run via `fh-builder`) |

Layering is strict and one-directional: `workflow-core ← workflow-builder ← app`.
Core never imports the builder; the builder never imports the app.

```
ts/
├─ package.json            # workspace root: lists members, aggregate scripts
├─ tsconfig.base.json      # shared compiler options + path mappings (see below)
├─ workflow-core/          # @foresthub/workflow-core
├─ workflow-builder/       # @foresthub/workflow-builder
├─ app/                    # @foresthub/app  (SPA + fh-builder CLI)
└─ node_modules/           # hoisted deps + @foresthub/* symlinks (gitignored)
```

## Resolution model: source in-repo, `dist` for consumers

This is the one thing to understand about the setup. There are two worlds:

| | `@foresthub/*` resolves to | How |
| --- | --- | --- |
| **Inside this repo** (typecheck, Vite dev, the CLI) | each package's **`src/`** | tsc `paths` (in `tsconfig.base.json`) + Vite `alias` (in `app/vite.config.ts`) |
| **An external consumer** (your frontend, `npm i …`) | each package's **`dist/`** | the package's `"exports"` map in its `package.json` |

In-repo, everything is **source** — contributors get types and HMR with no build
step, and the two tools (tsc + Vite) are kept in agreement on purpose. `dist/` is
produced **only for publishing**; nothing in the repo imports it. The `paths`/alias
are scoped to `ts/` and have zero effect on an installed package, so the two worlds
never collide.

`tsconfig.base.json` (extended by `workflow-core` and `workflow-builder`):

```jsonc
"paths": {
  "@foresthub/workflow-core":   ["./workflow-core/src/index.ts"],
  "@foresthub/workflow-core/*": ["./workflow-core/src/*/index.ts"],
  "@foresthub/workflow-builder":["./workflow-builder/src/index.ts"]
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
| `app` | `dev` | `vite` dev server |
| | `open` / `validate` / `cli` | the `fh-builder` CLI (see below) |

Run a package's script directly with `-w`, e.g. `npm run test -w @foresthub/workflow-core`.

## Local development

```bash
npm install                 # from ts/ — installs + links all three packages
npm run typecheck           # check the libraries
```

Run the builder in a browser via the reference app / CLI (from `ts/app`):

```bash
npm run dev                          # blank canvas, HMR
npm run open -- sample.json          # open a workflow; Save writes back to that file
npm run validate -- sample.json      # headless validation, non-zero exit on errors
# equivalently: npx fh-builder <open|validate> <file>
```

Because the app resolves the libraries to **source**, editing `workflow-core` or
`workflow-builder` hot-reloads instantly — no rebuild needed.

## Releasing (`workflow-core` + `workflow-builder`)

Consumers install the built packages, so a release means building `dist/` and
publishing. Core first (the builder depends on it):

```bash
npm run build
npm version <patch|minor|major> -w @foresthub/workflow-core
npm version <patch|minor|major> -w @foresthub/workflow-builder
npm publish -w @foresthub/workflow-core --access public
npm publish -w @foresthub/workflow-builder --access public
git push --follow-tags
```

For coordinated versioning + changelogs across both packages, prefer
[Changesets](https://github.com/changesets/changesets) (`npx changeset`,
`changeset version`, `changeset publish`).

**Prerequisites before the first real publish** (not yet wired):

1. **Pin the internal dep** — set `workflow-builder`'s `"@foresthub/workflow-core"`
   from `"*"` to a real range (e.g. `"^0.1.0"`). npm does not rewrite `*` on publish.
2. **Ship the builder's assets** — `tsc -b` does not copy `styles/index.css` or the
   i18n `*.json` into `dist/`. Add a copy step (or build the lib with `tsup`) and an
   `"exports"` entry for `./styles/*`, or consumers' CSS import will 404.
3. **Build green** — `workflow-core` must compile without errors to emit `dist/`.
4. Add `"prepublishOnly": "npm run build"` to each package so `dist/` is never stale.

## Conventions

- `dist/` and all `node_modules/` are gitignored; never commit build output.
- `src/api/workflow.ts` (core's contract types) **is** committed and regenerated
  via `npm run generate`; CI diffs it to keep TS and Go in lockstep.
- Tests (`*.test.ts`) are excluded from the library `build` (`tsc -b`); run them
  with `vitest`.
