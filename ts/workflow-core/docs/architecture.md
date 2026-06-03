# Architecture & Conventions

How the workflow types are layered, named, and split across packages. For the parameter-level contract (presence, `required`, pruning) see [parameters.md](./parameters.md); for the persisted save/export format and schema migration see [persistence.md](./persistence.md).

## Two layers: domain and api

Everything reduces to two representations of a workflow:

```
        api  ──  Schemas["Workflow"] etc., generated from contract/workflow.yaml
         ▲       (the wire format; what the Go backend produces/consumes)
         │   serialize / deserialize        ← owned by workflow-core
         ▼
      domain ──  Workflow → Canvas → Node / Edge (in-memory, headless)
         ▲       (what validation runs on; the intermediary for import/export)
         │   readStateFromStores / hydrate  ← owned by workflow-builder
         ▼
   editor stores ── Zustand + React Flow (the editor's live, internal shape)
```

- **api** is generated (`npm run generate` → `src/api/workflow.ts`); never hand-edit it. Call this layer **"api"** — not "contract" or "wire".
- **domain** is the in-memory shape the headless code understands. It is _not_ a persistence format and _not_ the editor's internal store shape — it's the neutral intermediary that import/export and validation pass through.
- **editor stores** exist only in `workflow-builder`; `workflow-core` knows nothing about Zustand or React Flow.

## Naming: the `Api` prefix

- A type with a twin in **both** layers: the api alias takes the `Api` prefix (`Foo` domain, `ApiFoo = Schemas["Foo"]`); the bare name is the domain type.
- A type that exists in **only** the api layer (no domain twin) keeps the **bare** name, re-exported from `src/api` so the domain shares one definition without cross-importing modules.

An `Api*` alias exists only where code names the api shape on its own — i.e. an entity with its own `serialize`/`deserialize`. A value type nested _inside_ such an entity is reached through its container's api type and keeps just the domain name; `deserialize` casts the looser api shape to the strict domain union at the boundary.

## Domain types

```
Workflow                       // canvases (keyed by id) + project-scoped channels / memory / models
└─ Canvas                      // nodes, edges, and their variable scope
   ├─ Node  = NodeData & { position }
   └─ Edge  = topology + data?: EdgeData
```

- **`Workflow`** (`workflow/Workflow.ts`) — the whole project. Canvases keyed by id; the main canvas is `MAIN_CANVAS_ID` (`"main"`), every other canvas is a function definition.
- **`Channel` / `Memory` / `Model`** are **self-contained domain entities** (project-scoped, not graph elements). The builder stores them as plain `Record<id, X>` and uses them directly — no envelope, no `data` split.

### Why `NodeData` / `EdgeData` exist (and differ from the above)

Nodes and edges are **graph elements rendered by React Flow**, which dictates a fixed envelope — node `{ id, type, position, data }`, edge `{ id, source, target, data }` — with a single user-controlled `data` slot. `NodeData` / `EdgeData` **are exactly that `data` payload**:

- **`NodeData`** is the node's `data` — the discriminated union over the per-variant node interfaces, each with typed `arguments`. The builder stores nodes as `Node<NodeData>` (xyflow generic), i.e. `NodeData` *is* `node.data`. (`NodeBase` is the generic untyped-`arguments` shape for code handling nodes without narrowing.)
- **`EdgeData`** is the edge's `data` — its optional payload.

So unlike the self-contained primitives, `NodeData`/`EdgeData` are **not** the full entity — they're the React-Flow `data` half. The headless domain flattens that half with its layout into a full entity for the `Canvas`: **`Node = NodeData & { position }`** and **`Edge`** = connectivity + `data?`. The editor projects back to `Node<…>` / `Edge<…>` at the store boundary. Because the flattened domain `Node`/`Edge` are **structurally assignable** to React Flow's, the builder uses them without an adapter and `workflow-core` stays free of `@xyflow/react`. This is why `NodeData`/`EdgeData` are pervasive in the builder — every canvas element wraps one — while the project primitives never need such a split.

## Package responsibilities (the boundary)

The two packages own **different** halves of the layering — keep the split clean:

**`workflow-core`** maps **domain ↔ api**, and nothing else:

- `serialize(domain)` / `deserialize(api)`, per entity and at the top level.
- Owns both layers' types and the parameter contract.
- Pure and headless: no React, Zustand, or DOM. Runnable in Node, a CLI, or a skill.

**`workflow-builder`** maps **editor stores ↔ domain**, and nothing else:

- `readStateFromStores()` reads the live Zustand/React Flow stores into a domain `Workflow`.
- `exportProject() = serialize(readStateFromStores())` — store → domain → api.
- `importProject(api)` = `deserialize(api)` then hydrate the stores — api → domain → store.

The builder never converts store ↔ api directly; it always goes **through the domain `Workflow`**, and `serialize`/`deserialize` always live in core. That single intermediary is what lets validation and the api stay UI-agnostic.

## Validation

Validation always runs on the **domain `Workflow`**, never on stores or api directly:

- `validateWorkflowState(workflow: Workflow)` (`diagnostics/`) is the headless validator.
- `validateWorkflow(api: ApiWorkflow)` (package root) is just `validateWorkflowState(deserialize(api))`.
- The editor calls `validateWorkflowState(readStateFromStores())` — domain reached from stores, no serialize round-trip needed.

So both entry points (live editor, imported api) converge on one validator over one shape.
