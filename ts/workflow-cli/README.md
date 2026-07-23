# @foresthubai/workflow-cli

`fh-workflow` — a self-contained CLI for authoring [Edge Agents](https://foresthub.ai)
workflow JSON. Validate workflows headlessly, or open them in the **visual builder**
(bundled into this package — no other install, no account, no network). Backed by
[`@foresthubai/workflow-core`](../workflow-core) and the
[`@foresthubai/workflow-builder`](../workflow-builder) canvas.

> This package doubles as the in-repo reference SPA + dev CLI (its directory is
> `ts/workflow-cli/`). Published builds bundle core + builder, so an installed copy has no
> runtime `@foresthubai/*` dependency.

## Install

```bash
npx @foresthubai/workflow-cli open my.workflow.json   # no install
# or
npm i -g @foresthubai/workflow-cli                     # then: fh-workflow …
```

Requires Node ≥ 20.

## Commands

```
fh-workflow open [file.json] [--static|--dev]   Open the visual builder; optionally pre-load a workflow.
fh-workflow check-schema <file.json>            Structural schema check against the contract. Non-zero on mismatch.
fh-workflow validate <file.json>                Semantic validation (references, wiring, types). Non-zero on errors.
fh-workflow update <file.json> [out.json]       Migrate a workflow to the current schema version.
fh-workflow deploy <file.json> [flags]          Generate a self-contained deployment bundle. --help for flags.
fh-workflow help | -h | --help                  Print usage.
```

### `open [file.json]`

Serves the builder and opens it in your browser.

- **With a file:** pre-loads that workflow and binds it so **Save writes back to the
  same file on disk** (round-trip through the `/api/file` bridge). An unknown path
  opens a blank canvas; the first Save creates it.
- **Without a file:** blank canvas in *standalone* mode. Save uses the browser File
  System Access API (Chrome/Edge/Opera) to pick a location; browsers without it
  (Firefox/Safari) fall back to a download.

The bound file's directory is the only path the bridge will read or write; anything
outside returns 403. The server binds `127.0.0.1` only.

**Two modes** (see [How it works](#how-it-works)): the installed CLI serves the
prebuilt SPA from a plain HTTP server on an ephemeral port (**STATIC**); in-repo it
spawns the Vite dev server with HMR (**DEV**). The build picks the default; override
with `--static` / `--dev` or `FH_BUILDER_MODE`.

### `check-schema <file.json>`

Structural gate — checks the raw JSON against the contract (`workflow.yaml`, shipped
with the package) using Ajv, **before** semantics. Reports shape errors (wrong
`type`, missing required field, bad enum) with a JSON-pointer path, and **exits `1`**
on any mismatch. Run it before `validate`.

### `validate <file.json>`

Semantic validation — no browser. Runs `workflow-core`'s pure validator (references,
wiring, types), prints `✗` errors / `⚠` warnings, and **exits `1` on any error**.
Suitable for CI / pre-commit.

### `update <file.json> [out.json]`

Migrates a workflow document up to the current schema version, in place or to a
second path.

### `deploy <file.json> [flags]`

Generates a self-contained, **standalone** deployment bundle for an edge controller —
a directory the engine boots from directly, with no backend and no account. It always
holds `engine-config.json` (the engine's single boot config — `workflow` + `mapping` +
`resources`, all in one blob), `docker-compose.yml`, `engine.env` (operator config,
written `0600`), a `deployment-spec.json` record, and a `README.md` with the
build/transfer/run steps. Workflows whose resources need credentials additionally get
`engine-secrets.json` (`0600`, the resolved resource-credential doc); hardware, MQTT, and
custom/self-hosted models are all folded into `engine-config.json`, not separate files.

Missing values are filled in **interactively** at a terminal. Without a terminal (a
Claude Code skill, CI), supply them through `--values <file.json>` — a partial deploy
config as JSON; any still-missing required value exits non-zero. LLM provider keys can
also be passed as flags (`--anthropic-key`, …). Run `fh-workflow deploy --help` for the
full flag list.

## In-repo development

From `ts/workflow-cli` (resolves the libraries to **source**, so editing core/builder
hot-reloads with no rebuild):

```bash
npm run dev                          # blank canvas, HMR
npm run open -- sample.json          # DEV: Vite dev server; Save writes back
npm run check-schema -- sample.json
npm run validate -- sample.json
node cli/fh-workflow.mjs open sample.json   # dev launcher direct (tsx/source); the published bin is fh-workflow
```

`-- ` before the argument is required with `npm run` so the path reaches the CLI.

Exercise the installed (STATIC) path locally:

```bash
npm run build:all                                    # SPA (vite) + CLI bundle (esbuild)
FH_BUILDER_MODE=static npm run open -- sample.json
```

## npm scripts

| Script | Does |
| --- | --- |
| `dev` | `vite` — dev server, blank canvas, HMR |
| `open` / `check-schema` / `validate` / `deploy` / `cli` | the dev CLI via `tsx` (`cli` = no preset subcommand) |
| `build` | `vite build` — the SPA bundle → `dist/` |
| `build:cli` | esbuild — the CLI bundle → `dist-cli/cli.js` (+ `workflow.yaml`) |
| `build:all` | both of the above; the publishable artifacts |
| `preview` | serve the built SPA |

## How it works

- **Published bin** is the esbuild bundle `dist-cli/cli.js`: one Node ESM file with
  `workflow-core`, `ajv`, `js-yaml`, `jsep` inlined — zero runtime deps, no `tsx`.
- **In-repo bin** is `cli/fh-workflow.mjs`, which loads the TypeScript CLI through
  [`tsx`](https://github.com/privatenumber/tsx) at runtime — no build step.
- **`open` (STATIC):** `server/staticServer.ts` serves the prebuilt SPA (`dist/`) +
  the `/api/file` bridge from a plain `http` server on an ephemeral port.
- **`open` (DEV):** spawns **Vite as a child process** (so Vite's config loader
  doesn't fight the tsx loader), polls the port, opens the browser.
- **The `/api/file` bridge** lives in `server/fileBridge.ts` — one handler shared by
  the Vite dev plugin (`plugins/filebridge.ts`) and the static server, so the
  read/write path-traversal guard exists in exactly one place.

## License

AGPL-3.0-only (or commercial). The package bundles the AGPL `workflow-builder` into
its SPA; `open` serves it over local HTTP, so the AGPL network clause applies — see
[NOTICE](./NOTICE). For commercial licensing: root@foresthub.ai.
