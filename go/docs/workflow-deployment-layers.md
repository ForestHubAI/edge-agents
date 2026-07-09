# Deployment layers: from workflow requirements to running code

A deployed workflow is **binding-free**: it declares *what* it needs (a GPIO input,
an MQTT topic, a custom model) but says nothing about *where* those live on this
particular device or network. Turning that abstract requirement into a live driver
handle, an open broker connection, or a registered LLM endpoint is the job of the
engine's boot plumbing. It happens in three layers, joined by two mappings:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Workflow requirements                                             │
│   Channels[] + Models[]   (declared in the workflow, keyed by logical id)   │
│   "I need a GPIO input `door_sensor`, an MQTT channel `alarm`, model `mistral-7b`" │
└───────────────────────────────────────────────────────────────────────────┘
            │
            │  ResourceMapping : logical id ─► ResourceBinding{ ref, index? }
            │  (one entry per channel id and per declared model id)
            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Resolved configs (the "where")                                    │
│                                                                             │
│   DeviceManifest         ◄── device-owned facts (what hardware exists)      │
│     gpios/adcs/dacs/serials/pwms : ref ─► {chip|device|port}                │
│                                                                             │
│   ExternalResources      ◄── environment-supplied facts (brokers, endpoints)│
│     MQTTs       : ref ─► MQTTConnection   {brokerUrl, prefixes, will, ...}   │
│     Providers   : ref ─► LLMProviderConfig {type, provider|url}             │
│     MLInference : ref ─► MLInferenceConfig {url, model} (ML sidecar)         │
│     Cameras     : ref ─► CameraConfig      {url}        (capture sidecar)    │
│                                                                             │
│   Manifest and ExternalResources ride in the one EngineConfig, read once at │
│   boot; the credentials they reference arrive in the secrets document.      │
└───────────────────────────────────────────────────────────────────────────┘
            │
            │  engine registries  (built once at boot, live for the process)
            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Code implementations                                              │
│   driver.Registry   : ref ─► GPIODriver / ADCDriver / ... (opened at boot)  │
│   transport.Registry: ref ─► MQTTTransport (paho conn, opened at boot)      │
│   llmproxy.Client    : modelID ─► Provider (local/backend/selfhosted routed) │
│   build/ml.go        : modelID ─► mlEndpoint      (ML sidecar client)       │
│   build/capture.go   : channelID ─► captureEndpoint (capture sidecar client)│
└───────────────────────────────────────────────────────────────────────────┘
```

The two arrows are the whole story:

1. **ResourceMapping** binds each *logical id* the workflow declares to a *platform
   resource id* (`ref`), plus an optional physical sub-address (`index`).
2. **Engine registries** turn each platform resource id (and its config) into a live
   code object.

`ref` is a *sharing identity*: many workflow channels can point at the same `ref`,
and the engine opens that driver / transport exactly once and shares the handle.

## One lifecycle: engine boot = runner boot

There is no boot-time vs deploy-time split, and no `/deploy` endpoint. The engine is
a **headless, single-workflow process**: `cmd/engine` reads one `EngineConfig` file
once at boot (the workflow, its `ResourceMapping`, the `DeviceManifest`, and the
`ExternalResources` — all in one document), builds one immutable `engine.Runner`, and
`Runner.Run(ctx)` blocks until the workflow exits or the process is signalled. No
hot-swap, no idle state, no in-process re-deploy — a runner exit ends the process.

"Deploying" a different workflow means shipping a new `EngineConfig` and restarting
the container; the orchestrator (Ranger) owns that swap externally. So everything
below — opening drivers, connecting brokers, composing the LLM client — happens
exactly once, at boot, from that single config. Where the old design distinguished
"boot-time, device-owned" from "deploy-time, swappable", the only surviving
distinction is **ownership** (device-owned hardware vs environment-supplied external
resources), not lifecycle.

---

## Layer 1 — what the workflow declares

A workflow carries two binding-free requirement lists (`contract/workflow.yaml`):

**`Channels[]`** — a discriminated union (`type`) of hardware and transport needs.
Each channel has a logical `id` and type-specific config that is *intrinsic to the
workflow*, not to the device:

| Channel type | Logical config (workflow-owned)        | Needs `index`? | Resource pool      |
|--------------|----------------------------------------|:--------------:|--------------------|
| `GPIOIN`     | `bias`, `debounceMs`                    | yes (line)     | DeviceManifest     |
| `GPIOOUT`    | —                                       | yes (line)     | DeviceManifest     |
| `ADC`        | —                                       | yes (channel)  | DeviceManifest     |
| `DAC`        | —                                       | yes (channel)  | DeviceManifest     |
| `PWM`        | `frequency`                             | yes (channel)  | DeviceManifest     |
| `UART`       | —                                       | no             | DeviceManifest     |
| `MQTT`       | `topic`                                 | no             | ExternalResources  |
| `CAMERA`     | `width?`, `height?`                     | no             | ExternalResources  |

**`Models[]`** — a discriminated union (`type`) of declared models. `LLMModel`s
(`id`, `label`, `capabilities`) are custom/self-hosted language models; static
catalog models (built into the llmproxy) are referenced by id from agent nodes and
need **no** declaration here. `MLModel`s (`id`, `label`) are machine-learning models
an `MLInference` node runs on a sidecar. Both kinds are listed only because they need
an environment-supplied endpoint. (A `CAMERA` capture source is a `Channel`, not a
model.)

The split is deliberate: `frequency`, `bias`, `topic`, `capabilities` describe *the
workflow's intent* and travel with it everywhere. The physical pin, the broker URL,
the inference endpoint are *environment facts* and are supplied separately.

---

## The join — ResourceMapping & ResourceBinding

`contract/engine.yaml` → `go/engine/types.go`:

```go
type ResourceMapping map[string]ResourceBinding   // keyed by workflow logical id

type ResourceBinding struct {
    Ref   string `json:"ref"`             // shared platform resource id
    Index *int   `json:"index,omitempty"` // physical sub-address; nil for UART/MQTT/CAMERA/memory/model
}
```

One entry per declared channel id **and** per declared model id (and per declared
`VectorDatabase`, see the RAG note). The pool a `ref` resolves against is **not**
stored in the binding — it is implied by the *type of the workflow resource* with
that id:

- a hardware channel's `ref` → a key in the **DeviceManifest**;
- an MQTT channel's `ref` → a key in the **ExternalResources.MQTTs**;
- a `CAMERA` channel's `ref` → a key in the **ExternalResources.Cameras**;
- a declared `LLMModel`'s `ref` → a key in **ExternalResources.Providers**;
- a declared `MLModel`'s `ref` → a key in **ExternalResources.MLInference**.

`index` is the per-channel physical line/channel number *within* the bound driver
instance. This is why a single `gpiochip0` driver (`ref`) can back many GPIO
channels — each with a distinct `index`.

**Catalog models are the exception — they get no mapping entry.** A `ResourceMapping`
entry exists only for *declared* resources (channels and custom models). A catalog
model — a built-in id referenced from an agent node, never declared — is resolved by
*identity*, not by name: the config lists its provider as an
`ExternalResources.Providers` entry (Layer 2), and the llmproxy routes the model id to
that provider at runtime by matching the provider's built-in `AvailableModels`. So a
catalog provider appears in `Providers` with **no `ref` in the mapping pointing at
it**. The rule: declared models are bound *by name* (a mapping entry); catalog models
are resolved *by identity* (llmproxy routing).

> **Completeness is enforced at build (boot), not at runtime.** A channel with no
> mapping entry, an addressable channel with a nil `index`, or a model bound to a
> `ref` that has no config are all hard build failures — the engine exits at boot;
> see "Validation" below. Silent degradation would hide config bugs until a node
> fires hours later.

---

## Layer 2 — the two config sources

Both config sources arrive together in the single `EngineConfig` read at boot. They
are kept as **separate artifacts because of different ownership**, not different
lifecycles:

### DeviceManifest — device-owned

`go/engine/types.go`. The hardware physically present on this device. Read from the
boot `EngineConfig`, mapped to domain (`mapping.DeviceManifestToDomain`), and used to
open the driver registry:

```go
type DeviceManifest struct {
    GPIOs   map[string]GPIOConfig   // id ─► {Chip:   "/dev/gpiochip0"}
    ADCs    map[string]ADCConfig    // id ─► {Device: "/sys/bus/iio/devices/iio:device0"}
    DACs    map[string]DACConfig    // id ─► {Device: ".../iio:device1"}
    Serials map[string]SerialConfig // id ─► {Port: "/dev/ttyUSB0", Baud: 115200}
    PWMs    map[string]PWMConfig    // id ─► {Chip:   "/sys/class/pwm/pwmchip0"}
}
```

The manifest is a fact about the box — Ranger fills it from what it knows the device
has. A different workflow on the same device sees the same manifest.

### ExternalResources — environment-supplied

`go/engine/types.go`. The configs that describe the *network/service environment* and
are not owned by the device: brokers, LLM provider instances, and the sidecars the
engine doesn't ship. Also carried in the boot `EngineConfig`:

```go
type ExternalResources struct {
    MQTTs       map[string]MQTTConnection    // ref ─► broker connection
    Providers   map[string]LLMProviderConfig // ref ─► one LLM provider instance
    MLInference map[string]MLInferenceConfig // ref ─► ML inference sidecar
    Cameras     map[string]CameraConfig      // ref ─► camera capture sidecar
}
```

`MQTTConnection` carries `brokerUrl`, optional `clientId`, the `publishPrefix` /
`subscribePrefix` the engine prepends to workflow topics, and an optional last-will.
`LLMProviderConfig` is **one provider instance** the engine registers into its single
llmproxy, discriminated by `Kind`:

- `selfhostedLlm` — a direct endpoint the llmproxy doesn't ship (`url`, optional bearer).
  The *declared* models bound to it via the mapping become its served models; several
  models can share one endpoint.
- `localLlm` — a built-in catalog provider (`provider`, e.g. `Anthropic`) the engine
  serves with an API key.
- `backendLlm` — the same catalog provider (`provider`) proxied to the backend, no key.

Only `selfhostedLlm` carries a `url`; only `localLlm` / `backendLlm` carry a `provider`.

**Secrets never live in the config.** The bearer token and API keys arrive out-of-band
in a mounted secret document (`component.SecretsFile`), a JSON map keyed by the same
`ref` (`engine.Secrets`). `cmd/engine` loads it at boot and
`mapping.ExternalResourcesToDomain` merges each secret into its connection at the
api→domain boundary. A catalog provider's served model ids are its built-in
`AvailableModels`, so they are **not** listed here (and, per the join above, carry no
mapping entry).

`MLInferenceConfig` carries a `url` + the `model` the sidecar selects on;
`CameraConfig` carries just a `url` — the sidecar owns a set of cameras and the one to
read is named per request. Both are trusted in-deployment endpoints with no
credential.

`ExternalResourceConfig` is a tagged union discriminated by `type`
(`mqtt` | `localLlm` | `backendLlm` | `selfhostedLlm` | `ml-inference` | `camera`);
new external-resource kinds extend that `oneOf`.

---

## Layer 3 — the registries that produce code

Each pool has a registry that maps `ref` → a live implementation, and **all three are
built once at boot**. `cmd/engine/main.go` owns the driver and transport registries
for the process lifetime and injects them into the `build.Builder`; `Builder.Build`
composes the LLM client. Both `Registry` types follow the same discipline: open
everything up front, and on any partial failure close what was opened so callers never
see a half-built registry. main closes them (`CloseAll`) when the runner exits.

### driver.Registry

`go/engine/driver/registry.go`. `NewRegistry(*DeviceManifest)` opens one driver per
manifest entry, **typed per family** so a miswired manifest (a GPIO id looked up as
an ADC) fails at registration, not first use:

```go
func (r *Registry) GPIO(id string)   (GPIODriver, error)
func (r *Registry) ADC(id string)    (ADCDriver, error)
func (r *Registry) DAC(id string)    (DACDriver, error)
func (r *Registry) PWM(id string)    (PWMDriver, error)
func (r *Registry) Serial(id string) (SerialDriver, error)
```

Built in `main` from the boot manifest and injected into the `Builder`.

### transport.Registry

`go/engine/transport/registry.go`. `NewRegistry(*ExternalResources)` opens one paho
MQTT connection per `ext.MQTTs` entry. Built in `main` from the boot
`ExternalResources`; a broker unreachable at boot is a retryable boot failure
(`boot.Retry`) so the orchestrator can restart. Ownership stays with `main`, which
closes it on runner exit.

### llmproxy.Client

`go/engine/build/llm.go` + `go/llmproxy`. `buildProviders(wf, dm, ext, backend)`
builds **one** provider per `ext.Providers` entry and composes them into the
`llmproxy.Client` the runner uses:

- `selfhostedLlm` → the declared models bound to that ref (via the mapping) become
  `ModelEndpoint`s on the shared `selfhosted.Provider`.
- `localLlm` → the named catalog adapter, constructed by the llmproxy registry from
  the API key (`llmcfg.Build`).
- `backendLlm` → a stand-in that forwards to the backend client, claiming that
  provider's static catalog models (`llmcfg.GetProviderModels`).

There is **no implicit backend fallback** — the client's providers are exactly what
`ext.Providers` declares. The provider for a chat call is resolved implicitly from the
**model id** (the client matches it against each provider's `AvailableModels`); there
is no client-level default. Like everything in Layer 3, `buildProviders` runs once,
at boot.

### sidecar endpoints — resolved per deploy

`go/engine/build/ml.go` + `capture.go`. Unlike the pooled registries above, ML
inference and camera capture are **not** engine-hosted: each resolves to a separate
sidecar container reached by URL. `buildDeployML` walks `wf.Models` and
`buildDeployCapture` walks the `CAMERA` channels, resolving each via the mapping to an
`ExternalResources` config, and builds one small HTTP adapter (`mlEndpoint` /
`captureEndpoint`) per model / camera — bound to that name, satisfying the
`MLInferenceClient` / `CaptureClient` port. Many models or cameras may share one
sidecar URL; the name is sent per request. See `docs/engine-ports.md`.

---

## The full resolution walk

Tracing boot through `cmd/engine/main.go` and `go/engine/build/`:

1. **`main` loads the boot config** — `loadEngineConfig(component.ConfigFile)` reads
   the one `EngineConfig` (workflow + mapping + manifest + externalResources); a
   missing config or an empty workflow (`SchemaVersion == 0`) is a fatal boot error.
   `loadEngineSecrets(component.SecretsFile)` reads the id-keyed secret document.

2. **`main` builds the process-owned registries** — `driver.NewRegistry(&manifest)`
   and `transport.NewRegistry(ext)` open all drivers and broker connections up front,
   and injects them (plus backend, memory, websearch, retriever) into the `Builder`.

3. **`Builder.Build(ctx, wf, mapping, ext)`** (`build.go`):
   - `Memory.Reconcile` refreshes the local memory snapshot against the declared files.
   - `buildProviders(wf, dm, ext, backend)` → one provider per `ext.Providers`
     entry (self-hosted endpoints for declared models; local/backend stand-ins for
     catalog providers) → the LLM client; `validateModelsResolvable` fails fast if an
     agent node references a model no provider can serve.
   - `buildRunner` assembles channels, collections, functions, and the graph. It also
     resolves the sidecar clients the node switch in `graph.go` needs:
     `buildDeployML(wf, dm, ext)` → per-model inference endpoints, and
     `buildDeployCapture(wf, dm, ext)` → per-camera capture endpoints.

4. **`buildChannels(wf.Channels, dm, drivers, transports, ext)`** (`channel.go`) —
   the heart of the join. For each declared channel, by type:

   ```
   GPIOIN "door_sensor"
     ├─ bindingFor(dm, "door_sensor")   → ResourceBinding{ref:"gpiochip0", index:17}
     ├─ indexFor(b, "door_sensor")      → 17                     (nil index = error)
     ├─ drivers.GPIO("gpiochip0")       → GPIODriver             (not registered = error)
     └─ &channel.GPIOInput{Driver, Line:17, Bias, DebounceMs}

   MQTT "alarm"
     ├─ bindingFor(dm, "alarm")         → ResourceBinding{ref:"site-broker"}
     ├─ ext.MQTTs["site-broker"]        → MQTTConnection          (missing = error)
     ├─ transports.MQTT("site-broker")  → MQTTTransport
     └─ &channel.MQTT{Transport, Topic, PublishPrefix, SubscribePrefix}
   ```

5. **`chs.SetupAll()`** runs after all nodes are built, applying each channel's
   accumulated requirements to its driver once (bias, PWM frequency, opening
   subscriptions).

6. **`runner.Run(ctx)`** blocks. The engine serves no inbound HTTP and self-reports no
   status — liveness is observed externally (Ranger / the container runtime). A runner
   exit ends the process; `main` closes the registries and surfaces the outcome via the
   exit code.

Nodes look up their linked channel in the per-build typed `channels` registry by
logical id and hold the pointer; every node referencing the same id shares one
instance, so subscriber lists and driver reservations stay consistent.

### Validation (boot-time, fail-fast)

| Failure                                              | Where                          |
|------------------------------------------------------|--------------------------------|
| channel id has no mapping entry / empty `ref`        | `bindingFor` (`channel.go`)    |
| addressable channel has nil `index`                  | `indexFor` (`channel.go`)      |
| hardware `ref` not in driver registry                | `drivers.GPIO/ADC/...`         |
| MQTT `ref` not in `ext.MQTTs`                         | `buildChannels` MQTT arm       |
| declared model not bound by the mapping              | `selfHostedEndpoints`          |
| declared model bound to a `ref` with no config       | `selfHostedEndpoints`          |
| declared model bound to a non-self-hosted provider   | `selfHostedEndpoints`          |
| unknown catalog provider id (`localLlm`/`backendLlm`)| `buildProviders`               |
| `backendLlm` provider but no backend configured      | `buildProviders`               |
| `CAMERA` channel unbound / `ref` not in `ext.Cameras` | `buildDeployCapture` (`capture.go`) |
| ML model unbound / `ref` has no ml-inference config   | `buildDeployML` (`ml.go`)      |
| agent node references an unservable model            | `validateModelsResolvable`     |
| `VectorDatabase` id has no mapping entry             | `buildCollections`             |

Every one of these exits the engine at boot (`boot.Fail`), so Ranger sees a failed
container rather than a workflow that silently misbehaves.

---

## A note on RAG / memory

RAG memory is now a **first-class mapped resource**, not a boot-injected side channel.
A workflow declares a `VectorDatabase` in its `Memory[]`; `buildCollections`
(`go/engine/build/build.go`) resolves each one through the `ResourceMapping`
(`bindingFor`) exactly as channels are resolved, binding the declared id to its
collection id (`ref`). A hard-fails on a missing binding, same as hardware/MQTT.
`Retriever` nodes hold their resolved `collectionID` and query through the
`engine.Retriever` backend, which is injected into the `Builder` at boot (the backend
client in cloud mode; nil standalone, which makes the build reject any `Retriever`
node with a clear error). File-backed memory (`MemoryFile`) is separate: the
`memory.Manager` owns durable local storage under the workspace mount and is
reconciled on `Build`.

---

## Designing a deploy wizard

The three layers map almost directly onto wizard stages. The wizard's job is to
**produce a complete `ResourceMapping` + `ExternalResources`** for a given
workflow against a given device/environment — the facts that, together with the
workflow and device manifest, become the `EngineConfig` the device boots from.

1. **Read the requirements (Layer 1).** Parse the workflow's `Channels[]`,
   `Models[]`, and declared `VectorDatabase`s, **plus the catalog model ids
   referenced by agent nodes** (walk the nodes — these aren't declared anywhere else).
   This is the exact, finite checklist: one row per channel, per declared model, per
   declared collection, and per distinct catalog *provider* the referenced models
   resolve to.

2. **Offer bindings from the right pool (the join).** For each requirement, the
   candidate `ref`s come from a *type-specific* pool:
   - hardware channel → keys of the matching `DeviceManifest` family (already known
     from the device Ranger provisioned);
   - MQTT channel → existing/new MQTT connection definitions;
   - `CAMERA` channel → existing/new capture-sidecar endpoints;
   - declared `LLMModel` → existing/new self-hosted endpoint definitions;
   - declared `MLModel` → existing/new inference-sidecar endpoints;
   - declared collection → existing/new vector-collection ids.

   Catalog providers aren't *bound* (they get no mapping entry) — instead offer a
   per-provider **routing choice**: serve it with a local API key (`localLlm`) or
   route it to the backend (`backendLlm`). For addressable hardware, also collect the
   `index`. Surface sharing explicitly: many channels may pick the same `ref`.

3. **Collect configs for newly-referenced resources (Layer 2).** Any `ref` the user
   picks that isn't device-owned needs an `ExternalResources` entry: broker URL +
   prefixes + credentials for MQTT; endpoint URL + optional bearer for a self-hosted
   model; for a catalog provider, a `localLlm` entry (with an API key) or a
   `backendLlm` entry (no key); a sidecar URL for an ML model or a camera. Secrets go
   to the mounted secret document keyed by `ref`, never into the config. Device-owned
   refs need nothing — their config is in the device manifest.

4. **Validate before submit.** Re-run the boot-time checks client-side so the user
   fixes gaps in the wizard, not via a failed container: every channel mapped, every
   addressable channel indexed, every model bound to a configured provider, every
   collection bound. The table under "Validation" is the authoritative checklist.

5. **Emit the config.** The wizard's output is exactly the binding half of an
   `EngineConfig`: `{ mapping, externalResources }`, joined with the workflow and
   device manifest and shipped to the device (and the secret document out-of-band).
   Layer 3 (the registries and live handles) is entirely the engine's concern at
   boot — the wizard never touches it.

Design implication: the wizard only ever authors **Layer 2 facts and the join**. It
should treat the `DeviceManifest` as read-only ground truth (what hardware exists) and
the workflow as a read-only requirement list (what's needed); everything it writes is
the binding between them plus the environment-supplied external configs.
