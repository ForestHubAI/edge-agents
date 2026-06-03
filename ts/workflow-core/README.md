# @foresthubai/workflow-core

Headless workflow model, serialization, and pure validation for the ForestHub
[edge-agents](https://github.com/ForestHubAI/edge-agents) platform. No React,
no DOM, no browser dependencies — this package is the language-neutral
TypeScript binding for the workflow graph format defined in
[`contract/workflow.yaml`](https://github.com/ForestHubAI/edge-agents/tree/main/contract).

The Go engine and the React-based workflow builder both consume this contract.
This package gives TypeScript callers the same three-layer model — generated
API types (the wire format), a hand-written domain model, and a pure
`validateWorkflowState` validator — without pulling in any UI or runtime
machinery.

## Install

```sh
npm install @foresthubai/workflow-core
```

## Quickstart

```ts
import { deserialize, validateWorkflowState } from "@foresthubai/workflow-core";

// `apiWorkflow` is the wire-format JSON produced by the engine or the builder.
const workflow = deserialize(apiWorkflow);
const result = validateWorkflowState(workflow);

if (!result.ok) {
  for (const diagnostic of result.diagnostics) {
    console.error(diagnostic.message);
  }
}
```

Subpath exports (`/api`, `/node`, `/edge`, `/channel`, `/memory`, `/model`,
`/deploy`, `/parameter`, `/function`, `/variable`, `/expression`, `/workflow`,
`/diagnostics`, `/migration`, `/id`) expose the individual domain modules; the
root barrel re-exports the most common types and the validator.

## Architecture

The repository [`ts/CLAUDE.md`](https://github.com/ForestHubAI/edge-agents/blob/main/ts/CLAUDE.md)
and [`workflow-core/docs/`](https://github.com/ForestHubAI/edge-agents/tree/main/ts/workflow-core/docs)
have the canonical write-ups on the API/domain/store layering, the parameter
contract, and the `Api`-prefix naming convention. The short version:

- **API layer** (`src/api/`) — generated from `contract/workflow.yaml`. Never
  hand-edit; regenerate with `npm run generate`.
- **Domain layer** (`src/{node,edge,channel,memory,model,function,workflow,
  parameter,variable,expression}/`) — hand-written in-memory shape for
  validation and import/export.
- **Validation** — `validateWorkflowState` runs on the domain `Workflow`.

## License

Apache License 2.0 — see [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).

The rest of the `edge-agents` repository (the engine and the React workflow
builder) is licensed under AGPL-3.0 or a separate commercial license. This
package is intentionally Apache-2.0 so it can be embedded freely in
downstream tooling and bindings.
