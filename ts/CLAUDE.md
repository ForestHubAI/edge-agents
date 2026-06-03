# ts/ — workflow model, builder, cli

npm workspace, TypeScript 5.6, ESLint 10 (flat config). The repo-wide rule about
the `contract/` being the source of truth applies here — see the root `CLAUDE.md`.

## Packages

```
workflow-core/     @foresthubai/workflow-core — headless model: types,
                   serialization, pure validator. NO React, NO DOM. The key lib.
workflow-builder/  @foresthubai/workflow-builder — React canvas/editor component
                   library. Depends on workflow-core. Consumed by workflow-cli AND
                   the closed FE.
workflow-cli/      @foresthubai/workflow-cli — the `fh-workflow` CLI + the
                   reference SPA it serves. Published to npm, self-contained:
                   bundles core + builder (vite for the SPA, esbuild for the CLI)
                   so it has no runtime @foresthubai/* dep. `open` runs Vite in
                   DEV (in-repo) and a plain static server in STATIC (installed).
                   Depends on both packages above (devDeps; bundled at build).
```

Dependency direction is strictly one-way: `workflow-cli → workflow-builder → workflow-core`.
Core never imports builder; builder never imports workflow-cli.

## workflow-core: the three layers

This is the single most important thing to get right. See
`workflow-core/docs/architecture.md` and `workflow-core/docs/parameters.md` for the
canonical write-ups.

1. **API layer** (`src/api/`): generated from `contract/workflow.yaml`. Wire format
   the Go backend produces/consumes. `src/api/workflow.ts` is GENERATED — never
   hand-edit; regenerate with `npm run generate`.
2. **Domain layer** (`src/{node,edge,channel,memory,model,function,workflow,
   parameter,variable,expression}/`): hand-written in-memory shape for validation and
   import/export. Owned by workflow-core. Not a persistence format. (`function/` owns
   the domain `FunctionDeclaration` — outputs bundled with their return expressions —
   and the split to the flat api `FunctionInfo`/`outputAssignments` at the wire.)
3. **Editor stores** (`workflow-builder/src/stores/`, Zustand + React Flow): live
   editor state. Owned by builder only; core never sees it.

```
API (wire) ⇄ serialize/deserialize ⇄ Domain ⇄ readStateFromStores/hydrate ⇄ Stores
            (workflow-core owns)            (workflow-builder owns)
```

**Validation always runs on the domain `Workflow`** via `validateWorkflowState`.
Never validate stores or api shapes directly — converge on the domain first.

### Conventions specific to core

- **`Api`-prefix naming:** a type with twins in both layers gets an `Api` alias —
  `Node` (domain) / `ApiNode = Schemas["Node"]` (api). A type that exists *only* in
  the api layer keeps its bare name and is re-exported from `src/api/` so other
  modules don't cross-import the generated file.
- **Barrels are the public boundary.** Every module's `index.ts` explicitly lists
  its exports. **No `export *`.** Do not import internal files across modules — only
  what a barrel re-exports is public. Within a module, import by file
  (`import { NodeDefinition } from "./NodeDefinition"`), then re-export in the barrel.
- **Parameter contract is three-way:** Definition (`NodeDefinition.parameters`,
  static schema) → Arguments (`NodeData.arguments`, an untyped `Record` holding ALL
  values including inactive/empty, for undo/redo) → API (serialized + pruned).
  `serialize` prunes any arg that is inactive or `isEmpty` (`undefined|null|""`);
  lists are never emptied (`[]` is valid). `activationRules` (conditionally present)
  and `optional: true` (always acceptable) are mutually exclusive intents. Keep all
  three layers in sync by hand.
- **NodeData/EdgeData are the React Flow `data` payloads.** Domain `Node =
  NodeData & { position }`; this keeps core free of `@xyflow/react`. Builder
  projects domain ↔ Flow nodes at the store boundary.

## Build / test / lint / generate

Run from inside `ts/`:

```
npm run generate    # regen workflow-core/src/api/workflow.ts from contract YAML
npm run build       # tsc -b across all three packages → dist/
npm run typecheck   # tsc -b workflow-core workflow-builder (tests excluded)
npm run lint        # eslint . (flat config)
npm run test        # vitest run (workflow-core only)
npm run dev         # vite dev server (workflow-cli)
```

- **Tests** are `*.test.ts` colocated in source, run by Vitest, and excluded from
  `tsc -b`. Don't import tests from production code.
- **ESLint** ignores `**/dist/**` and the generated `workflow-core/src/api/workflow.ts`.
  `no-unused-vars` is off (TS handles it); React packages enforce
  `react-hooks/rules-of-hooks`.

## Gotchas

- Path aliases (`@foresthubai/workflow-core`, `/node`, etc.) resolve to **`src/`**, not
  `dist/`, in-repo (tsconfig.base.json + Vite alias). No build needed during dev;
  published packages ship `dist/` via their `exports` maps.
- `tsconfig.base.json` is strict, including `noUncheckedIndexedAccess` — indexed
  access yields `T | undefined`. Handle it; don't `!`-assert reflexively.
- Editing `contract/workflow.yaml` requires `npm run generate` AND reconciling the
  hand-written domain serializers — the generated api types alone won't update them.
