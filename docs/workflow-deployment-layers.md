# Deployment layers: from workflow requirements to running code

A deployed workflow is **binding-free**: it declares _what_ it needs (a GPIO input, an
MQTT topic, a custom model) but says nothing about _where_ those live on this particular
device or network. Turning that abstract requirement into a live driver handle, an open
broker connection, or a registered LLM endpoint happens in **three layers, joined by two
arrows**:

```
┌───────────────────────────────────────────────────────────────────────┐
│ LAYER 1 — Workflow requirements          (what, keyed by logical id)  │
│   Channels[] + Models[] + Memory[]                                    │
└───────────────────────────────────────────────────────────────────────┘
            │  ResourceMapping : logical id ─► ResourceAddress{ref, index?|model?}
            ▼
┌───────────────────────────────────────────────────────────────────────┐
│ LAYER 2 — Resolved configs                       (where, keyed by ref)│
│   Resources — one frozen bag, keyed by ref, grouped by family:        │
│     device-owned (gpios..cameras) + environment-supplied              │
│     (mqttBrokers / llmProviders / mlProviders)                        │
└───────────────────────────────────────────────────────────────────────┘
            │  resource.Registry (+ llmproxy.Client) : ref ─► live object
            ▼
┌───────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Code implementations                    (how, opened once)  │
│   resource.Registry  (every driver + MQTT + ML client, one bag)       │
│   llmproxy.Client    (the LLM providers, one flat model namespace)    │
└───────────────────────────────────────────────────────────────────────┘
```

1. **ResourceMapping** binds each _logical id_ to a _platform resource id_ (`ref`), plus
   an optional sub-address.
2. **The engine** turns each `ref` (and its Layer 2 config) into a live code object: the
   one `resource.Registry` for drivers/MQTT/ML, the `llmproxy.Client` for LLM providers.

`ref` is a **sharing identity**: many requirements may point at one `ref`, and the engine
opens that resource exactly once and shares the handle. What tells those requirements
apart is their **discriminator** — see "The rule" below.

---

## How Layer 2 resources get configured

Resource config lives in Layer 2, never the workflow — a different workflow on this device
sees the same fact. Whether the driver runs in
another container is **not** a fact about the resource, and must never decide its home.
Packaging is a Layer 3 detail.

Sub-resource config **cannot** live in Layer 2, and this is structural, not a convention:
Layer 2 has one entry per `ref`, while the sub-resource is chosen by the mapping, which
Layer 2 cannot see. `resources.gpios[ref] = {chip}` has no slot for line 17's bias and
cannot have one. So it lives in something keyed by **channel id** instead.

| Config of          | Home                       | Keyed by   | Examples                                       |
| ------------------ | -------------------------- | ---------- | ---------------------------------------------- |
| the **resource**   | Layer 2                    | `ref`      | chip path, baud, broker url, camera source     |
| a **sub-resource** | the channel or the address | channel id | `bias`, `frequency`, `topic`; `index`, `model` |

Whether logical config lives on the channel or the address is decided by **logical fact vs.
deployment fact**, and nothing else. Which line a sensor is wired to, or what an operator's server
calls a model, is a fact about _this deployment_ → the address (the mapping). A topic name
is the workflow's intent → the channel.

Anything else a channel might carry is a **node argument**, not config: config is fixed at
build for the channel's life, while a node argument varies per invocation. Capture size is
the example — nothing configures `640×480`, and the next capture may ask for something else,
so it lives on `CameraCapture`. That is what makes `CAMERA` 1:1: with no size to discriminate
on, two sizes from one camera is two capture nodes on one channel.

---

## Layer 1 — what the workflow declares

Three binding-free requirement lists (`contract/workflow.yaml`), each keyed by a logical
`id`. The type-specific config here is _intrinsic to the workflow_, not to the device.

### `Channels[]` — hardware and transport needs

| Channel type | Logical config (workflow-owned) |    Sub-address    | Pool (`Resources.*`)             |
| ------------ | ------------------------------- | :---------------: | -------------------------------- |
| `GPIOIN`     | `bias`, `debounceMs`            |  `index` (line)   | `gpios` (device)                 |
| `GPIOOUT`    | —                               |  `index` (line)   | `gpios` (device)                 |
| `ADC`        | —                               | `index` (channel) | `adcs` (device)                  |
| `DAC`        | —                               | `index` (channel) | `dacs` (device)                  |
| `PWM`        | `frequency`                     | `index` (channel) | `pwms` (device)                  |
| `UART`       | —                               |         —         | `serials` (device)               |
| `CAMERA`     | —                               |         —         | `cameras` (device)               |
| `MQTT`       | `topic`                         |         —         | `mqttBrokers` (environment)      |
| `LOG`        | `level`, `tag?`                 |         —         | — (implicit: the ambient logger) |

### `Models[]` — declared models

| Model type | Logical config          |       Sub-address       | Pool (`Resources.*`) |
| ---------- | ----------------------- | :---------------------: | -------------------- |
| `LLMModel` | `label`, `capabilities` | `model` (upstream name) | `llmProviders`       |
| `MLModel`  | `label`                 |  `model` (served name)  | `mlProviders`        |

Listed only because they need an environment-supplied endpoint. **Catalog models** —
built-in ids referenced from agent nodes — are _not_ declared here and get no mapping
entry; see the join below.

### `Memory[]` — declared memory

| Memory type      | Logical config               |  Sub-address   | Pool                             |
| ---------------- | ---------------------------- | :------------: | -------------------------------- |
| `VectorDatabase` | —                            |       —        | — (`ref` _is_ the collection id) |
| `MemoryFile`     | `content`, `label`, size cap | — (no mapping) | — (device storage)               |

`MemoryFile` is device-storage-only and unmapped: `memory.Manager` owns it under the
workspace mount. See `docs/engine-ports.md`.

The split across all three lists is deliberate: `frequency`, `bias`, `topic`, `capabilities`
describe _the workflow's intent_ and travel with it; the physical pin, broker URL, and
inference endpoint are _environment facts_ supplied separately.

---

## The join — ResourceMapping & ResourceAddress

`contract/engine.yaml` → `go/engine/types.go`:

```go
type ResourceMapping map[string]ResourceAddress   // keyed by workflow logical id

type ResourceAddress struct {
    Ref   string  `json:"ref"`             // shared platform resource id
    Index *int    `json:"index,omitempty"` // driver sub-address (GPIO line / ADC-PWM-DAC channel)
    Model *string `json:"model,omitempty"` // endpoint sub-address (served model name); nil → the logical id
}
```

`Index` and `Model` are kind-specific and mutually exclusive.

### How it maps

| Layer 1 requirement         | Pool (`Resources.*`)             | Discriminator     | Lives in         | ids : ref | Unique by      |
| --------------------------- | -------------------------------- | ----------------- | ---------------- | :-------: | -------------- |
| `GPIOIN` / `GPIOOUT`        | `gpios`                          | `index` (line)    | mapping          |  **N:1**  | `(ref, index)` |
| `ADC`                       | `adcs`                           | `index` (channel) | mapping          |  **N:1**  | `(ref, index)` |
| `DAC`                       | `dacs`                           | `index` (channel) | mapping          |  **N:1**  | `(ref, index)` |
| `PWM`                       | `pwms`                           | `index` (channel) | mapping          |  **N:1**  | `(ref, index)` |
| `UART`                      | `serials`                        | —                 | —                |  **1:1**  | `ref`          |
| `CAMERA`                    | `cameras`                        | —                 | —                |  **1:1**  | `ref`          |
| `MQTT`                      | `mqttBrokers`                    | `topic`           | workflow         |  **N:1**  | `(ref, topic)` |
| `LOG`                       | — (implicit: the ambient logger) | `level`, `tag`    | workflow         |     —     | —              |
| catalog/declared `LLMModel` | `llmProviders`                   | `model`           | mapping / static |  **N:1**  | `model`        |
| declared `MLModel`          | `mlProviders`                    | `model`           | mapping          |  **N:1**  | `(ref, model)` |
| `VectorDatabase`            | — (`ref` _is_ the collection id) | —                 | —                |  **1:1**  | `ref`          |

### The rule

One rule generates the whole table:

> **A requirement is always unique by `(ref, discriminator)`. `ids : ref` is N:1 if and
> only if a discriminator exists — 1:1 when none does.**

That is what a discriminator is _for_: it is what makes N:1 routing to one `ref` safe, by
telling two requirements on the same resource apart. `UART` and `VectorDatabase` are 1:1
for the same single reason — they have nothing to discriminate on, so a second
requirement on that `ref` would be indistinguishable from the first.

**Layer 3 may drop the `ref`.** The rule is the default; a code layer that routes on the
discriminator _alone_ tightens it to a global constraint. `LLMModel` is the case: the
llmproxy resolves a chat by model id across **one flat namespace over every provider**
(`llmproxy.Client`), so a served model name must be unique _globally_, not per-`ref` —
and a self-hosted name that shadows a catalog id is the same collision. Hence the table's
`LLMModel` row is `model`, not `(ref, model)`. The engine enforces it at boot
(`NewClient` rejects a duplicate registration); the deploy resolver mirrors it (the `llm:`
key in `uniquenessKey`).

Uniqueness is not about whether a second claimant would _break_ something. It is the
design rule: one requirement, one thing. Two channels on one `(ref, index)`, two
`MLModel`s on one `(ref, model)`, two channels on one camera, two ids on one
`VectorDatabase` collection — all are the same requirement declared twice, and the right
expression is one requirement with several subscriber nodes, which is what
`channel.Broadcaster` is for: `UART`, `GPIOIN` and `MQTT` each claim their resource once
and fan out to every node that listens.

### Uniqueness — where the discriminator lives, and who enforces it

Which side holds the discriminator — channel or address — follows the logical-vs-deployment-fact
rule above and has **no bearing on cardinality**: `(ref, topic)` discriminates exactly as
`(ref, index)` does. `bias` and `frequency` sit on the channel but discriminate nothing — they
configure an address already owned. The one correctness corollary: a workflow-fact discriminator
must **not** be pushed into the Layer 2 config, or two requirements differing only by discriminator
resolve to two refs — two configs, two opens of one device.

Enforcement is split by _who authored the mapping_:

- **The resolver checks it at deploy.** `uniquenessKey` + `bindingConflicts` (`workflow-core`'s
  `deploy` module) are the canonical table: `uniquenessKey` maps a filled requirement to the string
  identifying the resource it claims, and two ids sharing a key are one claim declared twice. The OSS
  CLI and the backend run the same function over their own binding shapes. It cannot live in the
  builder — `(ref, discriminator)` is not complete until the `ref` is bound (two `MQTT` channels on
  topic `alarm` are legal until they land on one broker), so uniqueness is a property of the binding,
  not the workflow.
- **The engine re-defends it at the point of claim.** It keeps no Go twin of `bindingConflicts`; a
  second `(ref, discriminator)` pass would duplicate the resolver and still miss the real hazard.
  Instead each exclusive driver rejects a second claimant at `Setup` (`gpio_linux.go` on an
  already-configured line, `resource/mqtt.go` on a re-subscribed filter, and so on), so a mapping the
  resolver did not author — hand-edited or third-party — still fails the build (`boot.Fail`) rather
  than silently overwriting.

Two hazards need more than `(ref, discriminator)` and are enforced separately:

- **LLM global namespace** — a served model name must be unique across _all_ providers, not
  per-`ref` (see "The rule"); the engine's point of claim is `llmproxy.NewClient`, which rejects a
  model id served by two providers.
- **Camera device injectivity** — two _refs_ on one physical `/dev/video0` (content-addressed refs
  can manufacture it) needs the device path, not the ref, so it is a check over the assembled
  `Resources.cameras`, outside `uniquenessKey`.

---

## Layer 2

There is a **single `Resources` bag**, carried in the `EngineConfig` read at boot
(`contract/engine.yaml` → `engine.Resources`). It holds every platform resource keyed by
`ref`, grouped into per-family maps, and it materializes **1:1** into the Layer-3 registry
— one entry, one opened resource. Both local resources from devices `DeviceManifest` and
environment facts are collected here. The distinction that remains is _who
authors the fact_: the device-owned families are ground truth Ranger fills from what the
box has; the environment-supplied families are authored per deployment.

### Device-owned families — `gpios`, `adcs`, `dacs`, `pwms`, `serials`, `cameras`

The hardware physically present on this device. A fact about the box: a different workflow
on the same device sees the same entries.

| Family    | `ref` ─► config                                | Addressable parts  |
| --------- | ---------------------------------------------- | ------------------ |
| `gpios`   | `{Chip: "/dev/gpiochip0"}`                     | lines (`index`)    |
| `adcs`    | `{Device: "/sys/bus/iio/devices/iio:device0"}` | channels (`index`) |
| `dacs`    | `{Device: ".../iio:device1"}`                  | channels (`index`) |
| `pwms`    | `{Chip: "/sys/class/pwm/pwmchip0"}`            | channels (`index`) |
| `serials` | `{Port: "/dev/ttyUSB0", Baud: 115200}`         | —                  |
| `cameras` | `CameraSource {Kind: "v4l2" \| "rtsp" \| ...}` | —                  |

`CameraSource` is owned by `contract/camera.yaml` and `$ref`d here; `engine.yaml` stores
camera _instances_ but does not define what a kind means. The engine's domain type keeps
only the discriminator — it reaches every camera identically. See `camera-rework.md`.

### Environment-supplied families — `mqttBrokers`, `llmProviders`, `mlProviders`

The network/service environment the device does not own.

| Family         | `ref` ─► config                                                             | `type`          |
| -------------- | --------------------------------------------------------------------------- | --------------- |
| `mqttBrokers`  | `{brokerUrl, clientId?, username?, publishPrefix, subscribePrefix, will?}`  | `mqtt`          |
| `llmProviders` | `{url}` — a self-hosted endpoint the llmproxy doesn't ship                  | `selfhostedLlm` |
| `llmProviders` | `{provider}` — a built-in catalog provider reached directly with an API key | `directLlm`     |
| `llmProviders` | `{provider}` — the same catalog provider proxied to the backend, no key     | `backendLlm`    |
| `mlProviders`  | `{url}` — an ML component reached over HTTP                                 | `ml`            |

Each family's value is a tagged union discriminated by `type`. Only `selfhostedLlm` carries
a `url`; only `directLlm` / `backendLlm` carry a `provider`. A catalog provider's served
models are its built-in `AvailableModels`, so they are not listed here. Credentials
(`llmProviders` API key / bearer, `mqttBrokers` password) never appear in the config — see
Secrets below.

### Secrets

**Secrets never live in the config.** Credentials arrive out-of-band in a mounted secret
document (`component.SecretsFile`), a JSON map keyed by the same `ref`
(`component.Secrets`, read by `component.ReadSecrets`).

There is **no `secretRef`**: the ref _is_ the key, and a config's `type`/`kind` is what
says a credential may exist. A credential is part of a resource's identity — which is why
two otherwise-identical resources with different credentials stay distinct refs. Each
component receives only the secrets it needs. A missing secret leaves the credential
empty rather than failing: an anonymous broker is valid.

---

## Layer 3 — where code gets produced

There are exactly **two holders**, both built once at boot:

- **`resource.Registry`** — the one bag for _every_ opened resource: drivers **and** the
  MQTT connections **and** the ML component clients. `cmd/engine/main.go` opens it from the
  `Resources` bundle (`resource.NewRegistry`), owns it for the process lifetime, and
  injects it into `build.Builder`.
- **`llmproxy.Client`** — the LLM providers, composed separately in `build/llm.go` from
  `Resources.llmProviders`, because chat resolves across **one flat model namespace over
  every provider**, not per-`ref` (see "The rule").

The registry opens everything up front and, on partial failure, closes what it opened, so
callers never see a half-built registry.

| `Resources.*` family                                       | Holder              | `ref` ─► live object                                                                     | Opened                           |
| ---------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------------------- | -------------------------------- |
| `gpios` / `adcs` / `dacs` / `pwms` / `serials` / `cameras` | `resource.Registry` | `GPIODriver` / `ADCDriver` / `DACDriver` / `PWMDriver` / `SerialDriver` / `CameraDriver` | one per entry, in `main`         |
| `mqttBrokers`                                              | `resource.Registry` | `MQTTConnection` (paho conn)                                                             | one per entry, in `main`         |
| `mlProviders`                                              | `resource.Registry` | `MLClient` (HTTP to the component)                                                       | one per entry, in `main`         |
| `llmProviders`                                             | `llmproxy.Client`   | `Provider`                                                                               | one per entry, in `build/llm.go` |

The **ML client is one per component `ref`, not one per model**: a single `MLClient` fronts
a repository of models, and each `MLModel` binding selects one by name per request
(`build/ml.go` resolves bindings against `registry.ML(ref)`; it opens nothing).

`resource.Registry` is **typed per family**, so a miswired binding (a GPIO id looked up as
an ADC) fails at lookup, not first use:

```go
func (r *Registry) GPIO(id string)   (GPIODriver, error)
func (r *Registry) ADC(id string)    (ADCDriver, error)
func (r *Registry) DAC(id string)    (DACDriver, error)
func (r *Registry) PWM(id string)    (PWMDriver, error)
func (r *Registry) Serial(id string) (SerialDriver, error)
func (r *Registry) Camera(id string) (CameraDriver, error)
func (r *Registry) MQTT(id string)   (MQTTConnection, error)
func (r *Registry) ML(id string)     (MLClient, error)
```

A resource's transport is its own business: some open a device node, some speak HTTP to a
co-deployed component (camera, ML). That difference is invisible above this layer — callers
see a driver/client like any other. Registration therefore does not imply reachability.

An unreachable broker at boot is a **retryable** boot failure (`boot.Retry`, tagged via
`resource.IsTransient`) so the orchestrator can restart; hardware opens are never transient
(a missing device is a permanent config error). `main` closes the registry (`CloseAll`)
when the runner exits.

There is **no implicit backend fallback** in `llmproxy.Client` — its providers are
exactly what `Resources.llmProviders` declares. The provider for a chat call is resolved
implicitly from the **model id**, matched against each provider's `AvailableModels`; there
is no client-level default.

---

## Tracing the join

`buildChannels` (`go/engine/build/channel.go`) is where Layer 1 meets Layer 2. For each
declared channel, by type:

```
GPIOIN "door_sensor"                                    ← addressable
  ├─ addressFor(rm, "door_sensor")   → ResourceAddress{ref:"gpiochip0", index:17}
  ├─ indexFor(b, "door_sensor")      → 17                     (nil index = error)
  ├─ resources.GPIO("gpiochip0")     → GPIODriver             (not registered = error)
  └─ &channel.GPIOInput{Driver, Line:17, Bias, DebounceMs}    ← workflow-owned config

CAMERA "front_door"                                     ← no discriminator, no config
  ├─ addressFor(rm, "front_door")    → ResourceAddress{ref:"video0"}
  ├─ resources.Camera("video0")      → CameraDriver           (not registered = error)
  └─ &channel.Camera{Driver}                                  ← size is a node argument

MQTT "alarm"                                            ← environment family
  ├─ addressFor(rm, "alarm")         → ResourceAddress{ref:"site-broker"}
  ├─ res.MQTTs["site-broker"]        → MQTTBroker              (missing = error; prefixes)
  ├─ resources.MQTT("site-broker")   → MQTTConnection
  └─ &channel.MQTT{Transport, Topic, PublishPrefix, SubscribePrefix}
```

Same three moves every time: resolve the address, resolve the `ref` against `resources`
(the one registry), attach the workflow-owned config. MQTT reads its prefixes from the
`res.MQTTs` config _and_ its connection from the registry, both keyed by the same `ref`.
`buildCollections` and `buildDeployML` resolve declared `VectorDatabase`s and `MLModel`s
through the same `addressFor`.

Nodes look up their linked channel in the per-build typed `channels` registry by logical
id and hold the pointer; every node referencing the same id shares one instance, so
subscriber lists and driver reservations stay consistent. `SetupAll()` then runs after
all nodes are built, applying each channel's accumulated requirements to its driver once.

### Validation (boot-time, fail-fast)

| Failure                                                | Where                           |
| ------------------------------------------------------ | ------------------------------- |
| channel id has no mapping entry / empty `ref`          | `addressFor` (`channel.go`)     |
| addressable channel has nil `index`                    | `indexFor` (`channel.go`)       |
| one model id served by two providers                   | `llmproxy.NewClient`            |
| MQTT channel with an empty `topic`                     | `channel.MQTT.Setup`            |
| hardware `ref` not in registry                         | `resources.GPIO/ADC/Camera/...` |
| MQTT `ref` not in `res.MQTTs`                          | `buildChannels` MQTT arm        |
| declared model not bound by the mapping                | `selfHostedEndpoints`           |
| declared model bound to a `ref` with no config         | `selfHostedEndpoints`           |
| declared model bound to a non-self-hosted provider     | `selfHostedEndpoints`           |
| unknown catalog provider id (`directLlm`/`backendLlm`) | `buildProviders`                |
| `backendLlm` provider but no backend configured        | `buildProviders`                |
| ML model unbound / `ref` not in registry               | `buildDeployML` (`ml.go`)       |
| agent node references an unservable model              | `validateModelsResolvable`      |
| `VectorDatabase` id has no mapping entry               | `buildCollections`              |

Every one exits the engine at boot (`boot.Fail`), so Ranger sees a failed container
rather than a workflow that silently misbehaves.

---

## Designing a deploy wizard

The three layers map almost directly onto wizard stages. The wizard's job is to produce a
complete **`ResourceMapping` + the environment-supplied half of `Resources`** for a given
workflow against a given device/environment.

1. **Read the requirements (Layer 1).** Parse `Channels[]`, `Models[]`, and declared
   `VectorDatabase`s, **plus the catalog model ids referenced by agent nodes** (walk the
   nodes — these aren't declared anywhere else). This is the exact, finite checklist: one
   row per channel, per declared model, per declared collection, and per distinct catalog
   _provider_ the referenced models resolve to.

2. **Offer bindings from the right pool (the join).** Candidate `ref`s come from the
   type-specific family named in the mapping table above: device-owned requirements draw
   from the device families of `Resources` (`gpios`..`cameras` — read-only ground truth,
   the operator picks what the device has rather than typing a path); environment-supplied
   ones draw from existing/new entries in the `mqttBrokers` / `llmProviders` / `mlProviders`
   families.

   Collect the `index` / `model` sub-address only where the mapping carries one.
   **Surface sharing explicitly**: many requirements may pick the same `ref`, and that is
   the intended way to express one physical resource serving several logical needs.

   Then **enforce uniqueness over `(ref, discriminator)`** — including the workflow-fact
   discriminators (`topic`, `level`/`tag`), which the builder cannot check because it does
   not know the `ref`; see "Uniqueness" under the join.

   Catalog providers aren't _bound_ — instead offer a per-provider **routing choice**:
   reach it directly with an API key (`directLlm`) or route it to the backend (`backendLlm`).

3. **Collect configs for newly-referenced resources (Layer 2).** Any `ref` the user picks
   that isn't device-owned needs an entry in the matching environment family of `Resources`,
   per the Layer 2 table. Device-owned refs need nothing — their config is already in the
   device families. Secrets go to the mounted secret document keyed by `ref` (per component —
   each gets only its own), never into the config.

4. **Validate before submit.** Re-run the boot-time checks client-side so the user fixes
   gaps in the wizard, not via a failed container. The "Validation" table is the
   authoritative checklist.

5. **Emit the config.** The output is exactly the binding half of an `EngineConfig`:
   `{ mapping, resources }`, where `resources` merges the read-only device families with the
   environment families the wizard authored; shipped to the device with the workflow (and
   the secret document out-of-band).

**Design implication:** the wizard only ever authors **Layer 2 facts and the join**. It
treats the device families of `Resources` as read-only ground truth (what hardware exists)
and the workflow as a read-only requirement list (what's needed); everything it writes is
the binding between them plus the environment-supplied families. Layer 3 is entirely the
engine's concern at boot — the wizard never touches it.
