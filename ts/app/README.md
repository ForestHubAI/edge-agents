# @foresthubai/app

Reference host for [`@foresthubai/workflow-builder`](../workflow-builder): a small
Vite SPA that embeds `<WorkflowBuilder>` behind a toolbar (Open / Save / Clear /
Validate / theme), plus the **`fh-builder`** CLI that launches it against a file
on disk. This package is for local development and testing — **it is not published**.

See [`../README.md`](../README.md) for the workspace-level picture (how the
packages resolve to source, etc.).

## `fh-builder` CLI

```
fh-builder open [file.json]          Open the workflow builder; optionally pre-load a workflow.
fh-builder check-schema <file.json>  Structural schema check against the contract. Exits non-zero on mismatch.
fh-builder validate <file.json>      Semantic validation of a workflow. Exits non-zero on errors.
fh-builder help | -h | --help        Print usage.
```

### `open [file.json]`

Starts the Vite dev server and opens the builder in your browser.

- **With a file:** pre-loads that workflow, and binds it so **Save writes back to
  the same file on disk** (round-trip through the dev server's `/api/file` bridge).
  Creating a new path is fine — an unknown file opens a blank canvas and Save
  creates it.
- **Without a file:** opens a blank canvas in *standalone* mode. Save uses the
  browser File System Access API (`showSaveFilePicker`, Chrome/Edge/Opera) to pick
  a location and write directly; on browsers without it (Firefox/Safari) it falls
  back to a timestamped download.

The bound file's directory is the only path the bridge will read or write
(`FH_BUILDER_ALLOW_ROOT`); anything outside returns 403.

### `check-schema <file.json>`

Structural gate — checks the raw JSON against the contract
(`contract/workflow.yaml`) with Ajv, **before** semantics. Catches shape errors
(wrong `type`, missing required field, bad enum) with a JSON-pointer path
(e.g. `/nodes/0/arguments`), and **exits `1` on any mismatch**, `0` otherwise. Run
it before `validate`: a malformed shape should never reach the semantic validator.

### `validate <file.json>`

Semantic validation — no browser. Reads the file, runs `workflow-core`'s pure
validator (references, wiring, types), prints a report (`✗` errors / `⚠` warnings),
and **exits `1` if there are any errors**, `0` otherwise. Suitable for CI /
pre-commit. Pair it after `check-schema` for a structural-then-semantic pipeline.

## Running it

All equivalent — pick what fits:

```bash
# from ts/app
npm run open -- sample.json
npm run check-schema -- sample.json
npm run validate -- sample.json
npx fh-builder open sample.json

# from anywhere
node ts/app/cli/fh-builder.mjs check-schema path/to/workflow.json
node ts/app/cli/fh-builder.mjs validate path/to/workflow.json
```

The `-- ` before the argument is required with `npm run` so the path is passed to
the CLI rather than to npm.

## npm scripts

| Script | Does |
| --- | --- |
| `dev` | `vite` — dev server, blank canvas, HMR on builder/core edits |
| `open` / `check-schema` / `validate` / `cli` | the `fh-builder` CLI (`cli` = no preset subcommand) |
| `build` | `vite build` — bundles the SPA to `dist/` (the SPA, not a library) |
| `preview` | serve the built SPA |

## How it works (brief)

- `cli/fh-builder.mjs` is the bin entry; it loads the TypeScript CLI through
  [`tsx`](https://github.com/privatenumber/tsx) at runtime — no build step.
- `open` spawns **Vite as a child process** (rather than embedding it) so Vite's
  own config loader doesn't conflict with the tsx loader running the CLI, then
  polls the port and opens the browser.
- The `/api/file` bridge is a Vite plugin (`plugins/filebridge.ts`) active only
  during dev: `GET` reads, `PUT` overwrites, both restricted to the allowed root.
- The app resolves `@foresthubai/workflow-builder` and `@foresthubai/workflow-core` to
  **source** via Vite aliases (mirrored in `tsconfig.json`), so editing either
  library hot-reloads here without a rebuild.
