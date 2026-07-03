# Deployment layers: from workflow requirements to running code

A deployed workflow is **binding-free**: it declares *what* it needs (a GPIO input,
an MQTT topic, a custom model) but says nothing about *where* those live on this
particular device or network. Turning that abstract requirement into a live driver
handle, an open broker connection, or a registered LLM endpoint is the job of the
deploy plumbing. It happens in three layers, joined by two mappings:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Workflow requirements                                             │
│   Channels[] + Models[]   (declared in the workflow, keyed by logical id)   │
│   "I need a GPIO input `door_sensor`, an MQTT channel `alarm`, model `mistral-7b`" │
└───────────────────────────────────────────────────────────────────────────┘
            │
            │  DeploymentMapping : logical id ─► ResourceBinding{ ref, index? }
            │  (one entry per channel id and per declared model id)
            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Resolved configs (the "where")                                    │
│                                                                             │
│   DeviceManifest         ◄── boot-time, device-owned, NOT swappable         │
│     gpios/adcs/dacs/serials/pwms : ref ─► {chip|device|port}                │
│                                                                             │
│   ExternalResources      ◄── deploy-time, carried in the EngineConfig       │
│     MQTTs       : ref ─► MQTTConnection   {brokerUrl, prefixes, will, ...}   │
│     Providers   : ref ─► LLMProviderConfig {url, apiKey, model}             │
│     MLInference : ref ─► MLInferenceConfig {url}   (ML sidecar)              │
│     Cameras     : ref ─► CameraConfig      {url}   (capture sidecar)         │
└───────────────────────────────────────────────────────────────────────────┘
            │
            │  engine registries  (built once per boot / per deploy)
            ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Code implementations                                              │
│   driver.Registry   : ref ─► GPIODriver / ADCDriver / ... (opened at boot)  │
│   transport.Registry: ref ─► MQTTTransport (paho conn, opened at deploy)    │
│   llmproxy.Client    : modelID ─► selfhosted.Provider (registered at deploy) │
│   build/ml.go        : modelID ─► mlEndpoint      (ML sidecar client)       │
│   build/capture.go   : channelID ─► captureEndpoint (capture sidecar client)│
└───────────────────────────────────────────────────────────────────────────┘
```

The two arrows are the whole story:

1. **DeploymentMapping** binds each *logical id* the workflow declares to a *platform
   resource id* (`ref`), plus an optional physical sub-address (`index`).
2. **Engine registries** turn each platform resource id (and its config) into a live
   code object.

`ref` is a *sharing identity*: many workflow channels can point at the same `ref`,
and the engine opens that driver / transport exactly once and shares the handle.

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
a deploy-time endpoint. (A `CAMERA` capture source is a `Channel`, not a model.)

The split is deliberate: `frequency`, `bias`, `topic`, `capabilities` describe *the
workflow's intent* and travel with it everywhere. The physical pin, the broker URL,
the inference endpoint are *environment facts* and are supplied separately.

---

## The join — DeploymentMapping & ResourceBinding

`contract/engine.yaml` → `go/engine/manifest.go`:

```go
type DeploymentMapping map[string]ResourceBinding   // keyed by workflow logical id

type ResourceBinding struct {
    Ref   string `json:"ref"`             // shared platform resource id
    Index *int   `json:"index,omitempty"` // physical sub-address; nil for UART/MQTT/CAMERA/model
}
```

One entry per declared channel id **and** per declared model id. The pool a `ref`
resolves against is **not** stored in the binding — it is implied by the *type of the
workflow resource* with that id:

- a hardware channel's `ref` → a key in the boot **DeviceManifest**;
- an MQTT channel's `ref` → a key in the deploy **ExternalResources.MQTTs**;
- a `CAMERA` channel's `ref` → a key in the deploy **ExternalResources.Cameras**;
- a declared `LLMModel`'s `ref` → a key in **ExternalResources.Providers**;
- a declared `MLModel`'s `ref` → a key in **ExternalResources.MLInference**.

`index` is the per-channel physical line/channel number *within* the bound driver
instance. This is why a single `gpiochip0` driver (`ref`) can back many GPIO
channels — each with a distinct `index`.

> **Completeness is enforced at deploy, not at runtime.** A channel with no mapping
> entry, an addressable channel with a nil `index`, or a model bound to a `ref` that
> has no config are all hard build failures — see "Validation" below. Silent
> degradation would hide config bugs until a node fires hours later.

---

## Layer 2 — the two config sources

There are two config sources with **different lifecycles and ownership**, which is
the reason they are separate artifacts:

### DeviceManifest — boot-time, device-owned

`go/engine/manifest.go`. The hardware physically present on this device. Loaded once
at engine **boot** from a local file, reported to the backend in the
`AgentBootCallback`, and used to open the driver registry. It does **not** change on
deploy — swapping a workflow never re-opens GPIO chips.

```go
type DeviceManifest struct {
    GPIOs   map[string]GPIOConfig   // id ─► {Chip:   "/dev/gpiochip0"}
    ADCs    map[string]ADCConfig    // id ─► {Device: "/sys/bus/iio/devices/iio:device0"}
    DACs    map[string]DACConfig    // id ─► {Device: ".../iio:device1"}
    Serials map[string]SerialConfig // id ─► {Port: "/dev/ttyUSB0", Baud: 115200}
    PWMs    map[string]PWMConfig    // id ─► {Chip:   "/sys/class/pwm/pwmchip0"}
}
```

### ExternalResources — deploy-time, swappable

`go/engine/manifest.go`. Part of the `EngineConfig` boot file alongside the workflow
and mapping. These are the configs that *can* differ per deploy and are not owned by
the device:

```go
type ExternalResources struct {
    MQTTs       map[string]MQTTConnection    // ref ─► broker connection
    Providers   map[string]LLMProviderConfig // ref ─► self-hosted LLM endpoint
    MLInference map[string]MLInferenceConfig // ref ─► ML inference sidecar
    Cameras     map[string]CameraConfig      // ref ─► camera capture sidecar
}
```

`MQTTConnection` carries `brokerUrl`, optional credentials, the `publishPrefix` /
`subscribePrefix` the engine prepends to workflow topics, and an optional last-will.
`LLMProviderConfig` carries `url` + optional `apiKey`; the model's `id` and
`capabilities` come from the workflow's `LLMModel` declaration and are **not**
repeated here. `MLInferenceConfig` and `CameraConfig` each carry just a `url` — the
sidecar hosts a set (of models / of cameras) and the name to run is sent per request,
so nothing else is configured here; both are trusted in-deployment endpoints with no
credential.

`ExternalResourceConfig` is a tagged union discriminated by `type`
(`mqtt` | `selfhosted` | `ml-inference` | `camera`); new external-resource kinds
extend that `oneOf`.

---

## Layer 3 — the registries that produce code

Each pool has a registry that maps `ref` → a live implementation. Both `Registry`
types follow the same discipline: open everything up front, and on any partial
failure close what was opened so callers never see a half-built registry.

### driver.Registry — built at boot

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

This registry lives on the long-lived `Builder` (`go/engine/build/build.go`) and is
reused across every deploy.

### transport.Registry — built per deploy

`go/engine/transport/registry.go`. `NewRegistry(*ExternalResources)` opens one paho
MQTT connection per `ext.MQTTs` entry. Constructed fresh for each deploy, closed and
replaced on the next one; ownership transfers to the `Runner`.

### llmproxy.Client — composed per deploy

`go/engine/build/llm.go` + `go/llmproxy`. `buildDeployProviders` walks `wf.Models`,
resolves each via the mapping to a `Providers[ref]` config, and packs them into a
single `selfhosted.Provider`. `Build` then composes that with the boot provider set
into a fresh per-deploy `llmproxy.Client`. The provider for a chat call is resolved
implicitly from the **model id** — there is no client-level default.

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

Tracing one deploy through `go/engine/build/`:

1. **`Engine.Deploy(wf, dm, ext)`** (`engine.go`) builds the new runner *before*
   tearing down the old one — a config bug keeps the previous workflow serving
   instead of dropping the engine to idle.

2. **`Builder.Build`** (`build.go`):
   - `buildDeployProviders(wf, dm, ext)` → resolve declared LLM models → per-deploy
     LLM client; `validateModelsResolvable` fails fast if an agent node references a
     model no provider can serve.
   - `buildDeployML(wf, dm, ext)` → resolve declared ML models → per-model sidecar
     endpoints; `buildDeployCapture(wf, dm, ext)` → resolve `CAMERA` channels →
     per-camera sidecar endpoints (both keyed for the node switch in `graph.go`).
   - `transport.NewRegistry(ext)` → open all MQTT connections.

3. **`buildChannels(wf.Channels, dm, drivers, transports, ext)`** (`channel.go`) —
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

4. **`chs.SetupAll()`** runs after all nodes are built, applying each channel's
   accumulated requirements to its driver once (bias, PWM frequency, opening
   subscriptions).

Nodes look up their linked channel in the per-build typed `channels` registry by
logical id and hold the pointer; every node referencing the same id shares one
instance, so subscriber lists and driver reservations stay consistent.

### Validation (deploy-time, fail-fast)

| Failure                                              | Where                          |
|------------------------------------------------------|--------------------------------|
| channel id has no mapping entry / empty `ref`        | `bindingFor` (`channel.go`)    |
| addressable channel has nil `index`                  | `indexFor` (`channel.go`)      |
| hardware `ref` not in driver registry                | `drivers.GPIO/ADC/...`         |
| MQTT `ref` not in `ext.MQTTs`                         | `buildChannels` MQTT arm       |
| `CAMERA` channel unbound / `ref` not in `ext.Cameras` | `buildDeployCapture` (`capture.go`) |
| LLM model declared but not bound / no provider config | `buildDeployProviders`         |
| ML model unbound / `ref` has no ml-inference config   | `buildDeployML` (`ml.go`)      |
| agent node references an unservable model            | `validateModelsResolvable`     |

---

## A note on RAG / memory

`contract/engine.yaml` describes a fourth resource class — RAG memory resolving
"against the boot-configured backend (the ref is the collection id)". In the current
engine that binding does **not** flow through `DeploymentMapping`: the `Retriever`
backend is injected into the `Builder` at boot, and a `RetrieverNode` references its
collection directly via `arguments.memoryReference` (`go/engine/build/graph.go`).
Treat memory as boot-bound for now; if a deploy wizard surfaces it, model it as a
boot/backend concern rather than a per-deploy `ResourceBinding`.

---

## Designing a deploy wizard

The three layers map almost directly onto wizard stages. The wizard's job is to
**produce a complete `DeploymentMapping` + `ExternalResources`** for a given
workflow against a given device/environment.

1. **Read the requirements (Layer 1).** Parse the workflow's `Channels[]` and
   `Models[]`. This is the exact, finite checklist the wizard must satisfy — one
   row per logical id. The channel `type` tells you which pool and whether an
   `index` is required (see the Layer-1 table).

2. **Offer bindings from the right pool (the join).** For each requirement, the
   candidate `ref`s come from a *type-specific* pool:
   - hardware channel → keys of the matching `DeviceManifest` family (already known
     from the boot callback the backend stored);
   - MQTT channel → existing/new MQTT connection definitions;
   - `CAMERA` channel → existing/new capture-sidecar endpoints;
   - declared `LLMModel` → existing/new self-hosted endpoints;
   - declared `MLModel` → existing/new inference-sidecar endpoints.

   For addressable hardware, also collect the `index` (the physical line/channel).
   Surface sharing explicitly: many channels may legitimately pick the same `ref`.

3. **Collect configs for newly-referenced resources (Layer 2).** Any `ref` the user
   picks that isn't device-owned needs an `ExternalResources` entry: broker URL +
   prefixes + credentials for MQTT, endpoint URL + key for an LLM model, a sidecar
   URL for an ML model or a camera. Device-owned refs need nothing — their config is
   already in the boot manifest.

4. **Validate before submit.** Re-run the deploy-time checks client-side so the user
   fixes gaps in the wizard, not as an engine boot failure: every channel mapped,
   every addressable channel indexed, every model bound to a configured provider.
   The table under "Validation" is the authoritative checklist.

5. **Emit the deploy.** The wizard's output is exactly an `EngineConfig`:
   `{ workflow, mapping, externalResources }`. Layer 3 (the registries and live
   handles) is entirely the engine's concern — the wizard never touches it.

Design implication: the wizard only ever authors **Layer 2 facts and the join**. It
should treat the boot `DeviceManifest` as read-only ground truth (what hardware
exists) and the workflow as a read-only requirement list (what's needed); everything
it writes is the binding between them plus the swappable external configs.
