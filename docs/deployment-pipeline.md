# Deployment pipeline: from workflow to running containers

This is the model overview for how a workflow becomes running containers on a
device — the stages, the artifacts each produces, and (the load-bearing rule)
**where component-specific logic is allowed to live**. It sits on top of the
engine-internal resolution described in [`go/docs/deployment-layers.md`](../go/docs/deployment-layers.md);
that doc is about how the engine wires one `EngineConfig` into live drivers, this
one is about how a whole component set is packaged and rendered.

The contract artifact at the center is the `DeploymentSpec` (`contract/deployment.yaml`),
a generic list of `DeployComponent`s. The spec never names engine, llama, or any
specific component — that genericity is the whole reason the pipeline below has a
single generic render step instead of per-component renderers.

## Vocabulary

Four roles, used precisely throughout:

- **Resolver** (a.k.a. packaging step) — _produces_ the `DeploymentSpec`. Component-**aware**.
- **Renderer** — _turns_ a `DeploymentSpec` into runtime artifacts. Component-**generic**.
- **Image entrypoint** — runtime; the only place a component's _own_ behavior lives.
- **Operator** — supplies device-local secrets.

In OSS, one binary (the CLI) performs both the Resolve and Render stages — but
they are **separate stages with different branching rules**. That separation is
what lets the Render logic stay generic and mirror the paid nucleus.

## Ablauf

```
INPUTS: workflow graph + device manifest + operator bindings
        + user-authored custom DeployComponents (component.json)
                         │
┌─ STAGE 1 · RESOLVE (packaging) ──────────────────── COMPONENT-AWARE ─┐
│ actor:  OSS = CLI buildDeploymentSpec   |   Paid = FE / backend       │
│ does:   KNOWS engine & llama → computes their DeployComponents        │
│         (engine: config blob, volumes, devices, privileged, user;     │
│          llama: one per on-device model, command = --model/--port…)   │
│         MERGES user-authored custom DeployComponents verbatim         │
│ OUT:    ▸ DeploymentSpec   — frozen, committable, SECRET-FREE         │
│         ▸ secret VALUES    — extracted out-of-band (NOT in spec)      │
└──────────────────────────────────────────────────────────────────────┘
                         │   DeploymentSpec  ◄── the contract artifact
                         ▼
┌─ STAGE 2 · RENDER ────────────────────────────────────── GENERIC ────┐
│ actor:  OSS = CLI composeYaml   |   Paid = nucleus reconciler         │
│ does:   for each DeployComponent → one compose service, by the SAME   │
│         field mapping (image, config→file+mount+hash, volumes,        │
│         devices, ports, privileged, user, command, env_file).         │
│         NO per-component branches. Never reads inside config.         │
│ OUT:    OSS  ▸ docker-compose.yml                                     │
│              ▸ <name>-config.json   (one per component with config)   │
│         Paid ▸ reconcile actions against the container runtime        │
└──────────────────────────────────────────────────────────────────────┘
                         │   compose + config files
                         ▼
┌─ STAGE 3 · SUPPLY SECRETS ───────────────────── OPERATOR, on device ─┐
│ actor:  operator (guided by <name>.env.example, which is docs)        │
│ does:   fills secret values                                          │
│ OUT:    ▸ <name>.env   — device-local, never committed, never in spec │
└──────────────────────────────────────────────────────────────────────┘
                         │   + images (built locally OR pulled)
                         ▼
┌─ STAGE 4 · RUN ─────────────────────────────────── IMAGE entrypoint ─┐
│ actor:  docker compose / runtime + each image's own entrypoint        │
│ does:   start containers; each image interprets ITS config —          │
│         engine reads JSON file; llama consumes `command` args;        │
│         a wrapped image converts its config; etc.                     │
│ OUT:    ▸ running containers                                          │
└──────────────────────────────────────────────────────────────────────┘
```

## Where you may branch on component type

The invariant the whole design hangs on:

| Stage               |    Branch on component?    | Why                                                                                           |
| ------------------- | :------------------------: | --------------------------------------------------------------------------------------------- |
| **1 · Resolve**     | **YES** (first-party only) | it is the _producer_; it is allowed to know engine/llama                                      |
| **2 · Render**      |           **NO**           | uniform `DeployComponent → service` mapping; this is what makes custom components first-class |
| **4 · Run (image)** |   **YES** (itself only)    | each image interprets its own config; it never sees other components                          |

So component-specific logic has exactly **three legal homes**, and the renderer is
never one of them:

1. **Resolver code** — derivation for _first-party_ components (engine, llama).
2. **User authoring** — the `DeployComponent` for a _custom_ component (the human
   plays resolver for their own component).
3. **Image entrypoint** — runtime interpretation (build args from `command`, read
   the JSON config, convert a non-JSON format).

### First-party vs custom components

| component kind                         | who produces its `DeployComponent`   |    needs workflow-derived config?     |
| -------------------------------------- | ------------------------------------ | :-----------------------------------: |
| engine, llama (first-party)            | `buildDeploymentSpec` code (Stage 1) | yes — that is _why_ they are built in |
| broker / dashboard / custom sidecar    | the user, hand-authored              |                  no                   |
| third-party thing coupled to the graph | plugin hook (future, not built)      |       yes — the rare hard case        |

Custom components enter at the Stage-1 **merge**: the resolver appends
user-authored `DeployComponent`s to the ones it generated. They render in Stage 2
identically to first-party components. The _only_ thing reserved for first-party
is **auto-derivation of config from the workflow graph** (llama's `--model` is
computed from the workflow's model declarations) — that needs component-aware code
the platform cannot have for an unknown component. Auxiliary services that run
alongside the engine do not need it; static or operator-supplied config covers
them. See [`examples/components/`](../examples/components) for a worked custom
component.

## Artifact catalog

| Artifact             | Produced by                      | Lives                            | Secret? |           In the spec?            |
| -------------------- | -------------------------------- | -------------------------------- | :-----: | :-------------------------------: |
| workflow graph       | author                           | embedded in engine's `config`    |   no    | yes (inside the engine component) |
| **DeploymentSpec**   | Stage 1 resolver                 | committable file / control plane |   no    |        — it _is_ the spec         |
| `<name>-config.json` | Stage 2 renderer                 | deploy dir, bind-mounted         |   no    |  content lives in spec `config`   |
| `docker-compose.yml` | Stage 2 renderer                 | deploy dir                       |   no    |        derived, not stored        |
| `<name>.env`         | Stage 3 operator                 | device only                      | **yes** |              **no**               |
| images               | build (local) or pull (registry) | local daemon                     |   n/a   | referenced by the `image` string  |
| running containers   | Stage 4 runtime                  | device                           |    —    |                 —                 |

## Notes

- **The OSS/Paid split is only about _who_ runs Stages 1 and 2.** The artifact
  between them — the `DeploymentSpec` — and the Stage-2 field mapping are identical
  across both paths. That is the cross-language contract.
- **Config is spec-derived; secrets are device-supplied.** A component's `config`
  is frozen into the spec and rendered to a bind-mounted file at Stage 2. Secret
  _values_ never enter the spec — they live only in `<name>.env`, supplied by the
  operator at Stage 3, injected as environment variables by compose (the env file
  is never mounted into the container).
- **Restartable and offline.** Spec + cached images + device `<name>.env` files
  are everything a device needs to (re)start, across reboots, with no resolver,
  control plane, or network. Config changes are runtime (re-render + recreate),
  never image rebuilds.
- **Pending contract additions.** The mapping above assumes two `DeployComponent`
  fields not yet in `contract/deployment.yaml`: `command` (so a CLI-configured
  stock image like llama needs no wrapper) and `user` (the engine's
  nonroot-with-hardware case). Until they land, Stage 1 cannot express those and
  llama falls back to a wrapper image whose entrypoint builds the args at Stage 4.

```


notes:

Your test is the correct operational definition: if redeploying/reactivating can reconstruct it, it's config; if it can't, it's
  durable state. Restorability-from-spec is the boundary. That's a cleaner formulation than "small vs. large" or "overwritten vs.
  persistent" — it defines the two categories by the property that actually matters (can the spec regenerate it), and everything
  else (size, lifecycle, mount mode) follows from it.

  One place where you're actually cleaner than Greengrass, and it's worth knowing so you don't accidentally regress toward their
  model:

  Greengrass blurs the line, because component configuration is runtime-writable via IPC (UpdateConfiguration). So a component can
  accumulate device-side state inside its config — and then a later deployment that touches those keys can clobber it. Greengrass
  config is therefore a hybrid: partly deploy-versioned, partly device-mutated, with confusing precedence on redeploy. Your split is  stricter and better: config is purely deploy-derived (immutable per deploy, always restorable), workspace is purely
  device-authoritative (never restorable from spec). Nothing lives on both sides. That's precisely why your boundary test gives a
  clean yes/no where Greengrass's would be "it depends which config keys."
```
