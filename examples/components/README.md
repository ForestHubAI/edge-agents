# Example components

`DeploymentSpec` (see `contract/deployment.yaml`) runs a **generic** list of
`DeployComponent`s. The contract never names a specific component — engine,
llama-server, an MQTT broker, or anything you bring yourself are all just a
`DeployComponent`. That means you add a component by **producing one of these
objects**, not by editing the contract.

Each folder here is a worked example of one component's "plumbing": the image
it runs, the config it gets, the secrets it expects, and the `DeployComponent`
that wires it up.

- [`grafana/`](./grafana) — a third-party image (a local dashboard) shown as the
  *wrapped* case: Grafana's config is INI/`GF_*` env, not JSON, so it gets a thin
  wrapper entrypoint that translates the spec's JSON `config` into Grafana's own
  env vars. Demonstrates `config`, a device-local secret, a port, a volume, and a
  `Dockerfile` carrying the healthcheck.

## The component contract in one screen

A `DeployComponent` is runtime-neutral container knobs only — `name, image,
config?, configPath?, volumes?, devices?, ports?, privileged?`. Everything
specific to your component lives in **your image**, not in the spec's type system:

| Concern | Where it lives | In the spec? |
| --- | --- | --- |
| Non-secret config (endpoints, ports, flags) | `config` (a JSON object), rendered to a file and mounted at `configPath` | Yes — frozen, committable |
| Secrets / device tunables (API keys, passwords) | device-local `<name>.env`, attached via compose `env_file` | **No** — operator-supplied, never committed |
| Where the container reads its config | `configPath`, default `/etc/foresthub/config.json` | Only if non-default |
| How the container starts / interprets config / reports health | the image's entrypoint + `HEALTHCHECK` | No |
| Start ordering between components | nothing — components are an unordered set | No |

Two rules follow from this and are worth internalizing:

1. **Config is spec-derived; env is device-supplied.** `config` is computed by the
   packaging step and frozen into the spec (reproducible, shareable), rendered to
   JSON and bind-mounted *into* the container at `configPath`. A secret's *value*
   never enters the spec — it lives only in `<name>.env` on the device and is
   injected as environment variables by compose (the env file is never mounted
   into the container). Opposite ends, different mechanisms.

2. **The spec is self-contained and restartable.** Spec + cached images +
   device `<name>.env` files are everything a device needs to (re)start, offline,
   across reboots. No resolver, no control plane, no network.

## JSON-native vs wrapped

The renderer always writes `config` as **JSON** to `configPath`. So:

- A component whose app **reads JSON config** (like the engine) uses the stock
  image unchanged — it just reads `/etc/foresthub/config.json`. No wrapper.
- A component whose app reads some **other format** (INI, conf, CLI flags) gets a
  **thin wrapper entrypoint** baked into its image that converts the JSON into
  what the app wants, then `exec`s it. The `grafana/` example shows this. The
  conversion is the image's business; the spec stays generic.

## Adding your own component

1. Build/choose an image. If it reads JSON config from `/etc/foresthub/config.json`,
   you're done. If not, add a thin wrapper entrypoint that translates the JSON and
   bake the `HEALTHCHECK` into the image.
2. Document the secret env vars it needs in a `<name>.env.example` — there is no
   spec field enumerating them, so this doc *is* the interface for the operator.
3. Produce a `DeployComponent` (see `grafana/component.json`) and add it to a
   `DeploymentSpec`'s `components` list.

## No component dependencies — on purpose

Components do not declare dependencies. When one component needs another (e.g.
the engine calling an on-device model), that coupling is a **URL the consumer
connects to at runtime with retry**, not a start-ordering edge. This is what lets
the dependency live on this device *or* another one with no change to the model:
local is just a different URL. See `contract/deployment.yaml` for the rationale.
