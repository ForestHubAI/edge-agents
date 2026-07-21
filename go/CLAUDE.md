# go/ — engine runtime + LLM proxy

Go module `github.com/ForestHubAI/edge-agents/go`, Go 1.25. The repo-wide rule about
the `contract/` being the source of truth applies here — see the root `CLAUDE.md`.

## Packages

```
cmd/engine/   engine binary: lean main — loads config, wires deps, runs a
              runner built in engine/. Only config.go + main.go.
cmd/camera/   fh-camera binary: lean main — loads config, wires deps, runs the
              HTTP server built from camera/. Only config.go + main.go.
api/          oapi-codegen output from ../contract/*.yaml (engineapi, workflow,
              llmapi, debugapi, mlapi, cameraapi). GENERATED — never
              hand-edit; regen instead.
component/    the component contract every binary boots against: fixed
              in-container paths, canonical names/ports, exit-code policy,
              BootFail/BootRetry, the generic LoadConfig[T], and Secrets +
              ReadSecrets. A leaf — imports only logging.
engine/       core runtime + its OWN api<->domain mapping (mapping.go). Sub-pkgs:
              runner (state machine), node, expr, build, backend, driver,
              channel, memory, transport, websearch.
camera/       fh-camera domain: per-kind capture pipelines, setup-script runner,
              the cameraapi HTTP server, and its OWN api<->domain mapping.
logging/      generic zerolog wrapper: structured JSON to stdout. No shipping or
              rotation — the container runtime captures the stream (see below).
llmproxy/     unified LLM provider abstraction (anthropic/openai/gemini/mistral/
              selfhosted), provider dispatch by model id, agent loop.
util/         http client, linked map, pointer helpers.
```

## Components are self-contained

Each component (`engine/`, `camera/`, and whatever comes next) owns everything it
needs to boot and run — including **its own api↔domain mapping**, in its own
package. There is no shared mapper, no shared domain, no `mapping/` hub.

The reason is binary size and coupling, not taste. A shared mapper has to import
every domain it maps, so importing it drags all of them in: `cmd/camera` →
`mapping` → `engine` → `llmproxy` → … and a driver component that shells out to
`gst-launch` links the entire workflow runtime it never calls. The same rule
killed the `CameraSource` type living in `engine.yaml`: it made `cameraapi` import
`engineapi`, so the contract had the dependency backwards too.

The rule, precisely — it is about **what a package drags behind it**, not about
sharing as such:

- **A component package must never import another component's domain.** `camera`
  does not import `engine`, and vice versa. If both need the same shape, it
  belongs in the contract as a seam type, not in a shared Go package.
- **Shared packages are fine only if they are leaves.** `component`, `logging`,
  and `util` are shared by everything and cost nothing, because they import no
  component domain — `component` imports only `logging`. Adding a domain import to
  any of them re-creates the `mapping` problem instantly.
- **Cross-component shapes cross via the contract**, and each side maps it into
  its own domain privately (`engine/mapping.go`, `camera/mapping.go`). A generated
  type never reaches domain logic — map it first.
- **Direction check when in doubt:** would this import make a component link a
  runtime it never calls? Then it is wrong, however convenient.

## Architecture

`cmd/engine` builds one immutable `engine.Runner` at boot via `engine/build.Builder`
(which injects deps: Drivers, Backend, LLM, Memory, WebSearch) and runs it
synchronously — `Runner.Run(ctx)` blocks until the workflow exits or `ctx` is
cancelled. No hot-swap, no idle state, no engine wrapper: a runner exit ends the
process.
The `Runner` interprets the workflow graph as a **state machine**: wait for event →
execute node → transition. Triggers run as parallel goroutines.

The engine serves no inbound HTTP. It is a headless process that boots from a
single `EngineConfig` file (workflow + bindings + device manifest, read once at
boot) and writes logs to stdout as structured JSON — nothing is shipped; the
container runtime captures the stream and a reader (Ranger in the hosted path,
`docker logs`/a collector in OSS) routes it. Status and liveness are likewise
observed externally by Ranger (the ranger), not self-reported — a boot failure
exits the process and Ranger sees a failed container. `engine.yaml` is a
types-only contract for that outbound wire. Node instantiation is a
hand-written switch on the workflow `Node` discriminator in
`engine/build/graph.go`.

## Conventions

- **Errors:** wrap with `fmt.Errorf("context: %w", err)`. No custom error types or
  sentinel errors as a rule. Fatal-at-startup via the logger in `main`.
- **Logging:** `zerolog` via `logging`. Use the package `Logger`; structured
  fields (`.Str/.Int/.Err`).
- **Context:** every async boundary takes `ctx context.Context`. Runner lifecycle
  uses `WithCancel`; boot/config use `WithTimeout`. Honor `ctx.Done()`.
- **Config:** `caarlos0/env` struct tags (`env:"ENGINE_ID" envDefault:"..."`),
  loaded in `cmd/engine/config.go`. Env vars are `ENGINE_*` / `FH_BACKEND_*`.
  Listen addresses are never env vars — a component's port is contracted in
  `component/constants.go`, since its caller dials that constant.
- **Interfaces** are capability-focused and suffixed by role: `Executable`,
  `Trigger`, `Emitter`, `ToolProvider`, `HasSetup` (node contracts);
  `Provider`/`Embedder` (llmproxy). Optional capabilities are separate interfaces
  a type may also satisfy, not fields.
- **Tests:** `testify` (`assert`/`require`). Mocks via `mockery` (`.mockery.yaml`),
  regenerated by `go generate`.

## Build / test / generate

```
go generate ./...            # regen api/*.gen.go (oapi-codegen) + mockery mocks
go build ./cmd/engine        # build the engine binary
go test ./...                # testify-based tests
```

No Makefile. Run from inside `go/`.

## Gotchas

- **Scope is single-threaded after Setup.** Only the state-runner mutates `Scope`
  (`engine/scope.go`). Cross-trigger communication goes through subscribed
  channels, not direct scope writes.
- **`StateIdle` (`""`) is meaningful** — it means "waiting for an event," not "no
  state." Nodes execute only when state != idle.
- **`Event.Apply` carries data into Scope.** Trigger output reaches the runner via
  an optional `Apply` closure run before the transition, not via return values.
- **Provider is resolved implicitly from the model id** in `llmproxy.Client.Chat`.
  Unknown model → error; no Client-level default. Backend fallback is wired at
  registry-build time, not at call time.
- **Backend client is optional** (nil → locals-only LLM, no memory mirror); the
  engine still boots. Logs go to stdout regardless of the backend. The workflow, bindings, and device manifest
  arrive as one `EngineConfig` file read once at boot.
- **Nodes are instantiated once at build**, reused across executions — node state
  persists unless `Execute` clears it.
- **Every component boots the same way.** `component.LoadConfig[T]()` reads the one
  boot config at the contracted path (missing/malformed = permanent, `BootFail`);
  `component.ReadSecrets()` reads the credential document (**absent is normal** —
  it means nothing needs a credential). Secrets are keyed by the resource's own
  ref: there is no `secretRef` to resolve, and a config's `type`/`kind` is what
  says a credential may exist.
