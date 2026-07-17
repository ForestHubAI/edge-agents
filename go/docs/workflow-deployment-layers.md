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
│   DeviceManifest      ◄── device-owned facts                          │
│   ExternalResources   ◄── environment-supplied facts                  │
└───────────────────────────────────────────────────────────────────────┘
            │  engine registries : ref ─► live object
            ▼
┌───────────────────────────────────────────────────────────────────────┐
│ LAYER 3 — Code implementations                    (how, opened once)  │
│   driver.Registry / transport.Registry / llmproxy.Client / endpoints  │
└───────────────────────────────────────────────────────────────────────┘
```

1. **ResourceMapping** binds each _logical id_ to a _platform resource id_ (`ref`), plus
   an optional sub-address.
2. **Engine registries** turn each `ref` (and its Layer 2 config) into a live code object.

`ref` is a **sharing identity**: many requirements may point at one `ref`, and the engine
opens that resource exactly once and shares the handle. What tells those requirements
apart is their **discriminator** — see "The rule" below.

---

## The model: where every fact lives

**This section is normative.** Every recurring bug in this area has been the same mistake
wearing a different hat: a camera classified as an `ExternalResource` because its driver
was in another container; a channel id punched through to a Layer 2 key; capture size
declared as channel config. Each is a fact placed in the wrong home.

There are exactly three homes.

| Home                | Holds                                        | Keyed by   | Examples                                                      |
| ------------------- | -------------------------------------------- | ---------- | ------------------------------------------------------------- |
| **Layer 2 config**  | facts about the resource itself               | `ref`      | device path, baud, broker url, camera kind/device/credentials |
| **The address**     | `ref` + discriminator                         | channel id | `index`, `model` (mapping facts); `topic`, `level`/`tag` (logical facts) |
| **Node arguments**  | what you ask of the resource, per operation   | node       | capture `width`/`height`                                      |

### The rules

**R1 — A fact about the resource lives in Layer 2, never the workflow.** A different
workflow on this device sees the same fact. The corollary that keeps being missed: whether
the resource's driver happens to run in another container is **not** a fact about the
resource, and must never decide its home. Packaging is a Layer 3 detail (see
`camera-rework.md`).

**R2 — Per-subindex config cannot live in Layer 2.** Layer 2 is keyed by `ref`, one entry
per resource, and the subindex is chosen by the mapping, which Layer 2 cannot see.
`manifest.gpios[ref] = {chip}` has no slot for line 17's bias and cannot have one. So
per-subindex config lives in something keyed by **channel id**: the **mapping** (a
deployment fact) or the **channel** (a logical fact). Both remain open — R4 picks.

**R3 — A channel field is legitimate only if it completes the address, or is setup config
for that address.** Anything else is a node argument. See the test below.

**R4 — Logical fact or deployment fact decides mapping vs. channel.** Which line a sensor
is wired to, or what an operator's server calls a model, are facts about *this deployment*
→ the mapping. A topic name is the workflow's intent → the channel. The location has **no
bearing on cardinality**: `(ref, topic)` discriminates exactly as `(ref, index)` does.

### The test: address or argument?

**The mechanism cannot tell you.** `channel.MQTT.Topic` and `channel.Camera.Width` are
both channel fields, frozen at build, passed into a per-call API — identical shapes.
Anyone reasoning from the code will keep getting this wrong. Ask instead:

> **Does the field name something that exists independently of any request?**

| Field           | Names                                                                                          | Verdict      |
| --------------- | ---------------------------------------------------------------------------------------------- | ------------ |
| `topic` `alarm` | an endpoint on the broker — other clients publish to it whether or not this workflow runs       | **address**  |
| `level` + `tag` | a stream in the output a reader can filter on                                                   | **address**  |
| line 17         | a pin that exists in silicon                                                                    | **address**  |
| `yolov8`        | a model in the component's repository                                                           | **address**  |
| `640×480`       | **nothing.** No such endpoint exists on the camera; it comes into being when you ask and is gone when the pipeline tears down | **argument** |

A destination persists; a request shape does not.

**Structural backstop**, when the semantic test feels slippery: a discriminator is honest
only if the resource genuinely **hosts those endpoints at once**. One broker connection
serves N topics concurrently, one logger serves N streams, one gpiochip drives 40 lines.
A camera does not — `gstreamerSource.mu` serializes every capture because the device is
single-open. Endpoints that cannot coexist are fiction.

### The home is the decision

Where a field lives **is** the design choice, not a consequence of one. `tag` on the `LOG`
channel declares *a tagged stream is a destination* — a second tag means a second channel.
`tag` on the writing node would declare *a tag is a per-message label*. Both are coherent;
the model's job is to force the choice to be stated rather than defaulted into.

`width`/`height` are **not** such a choice: there is no reading in which `640×480` is a
destination. The nearest attempt — "a low-res camera profile" — is a Layer 2 concept, and
it pins one size per entry, producing two refs on one `/dev/video0`.

### Resources may be implicit

`LOG` carries no `ref` and no mapping entry, and that is **not** an absence of a resource:
the ambient `logging.Logger` *is* the resource, injected as a package global rather than by
a registry. It is a singleton, so its `ref` would be constant — and a constant carries no
information, so it is omitted. `LOG` is therefore `MQTT`'s shape exactly (a shared resource
beneath N endpoints), N:1 over an implicit ref, unique by `(level, tag)`.

> **Absence of a `ref` is not absence of a resource.** Reading it the other way is what
> made a camera an `ExternalResource`.

### Known deviations

The rules are normative; the code has not caught up everywhere. Tables elsewhere in this
document describe the system **as it is**.

| Deviation                                                            | Rule        | Status                                                                          |
| -------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------- |
| `CAMERA` carries `width`/`height` as channel config, making it N:1     | R3          | Decided wrong; they are node arguments and camera is 1:1. Contract change pending. |
| `(ref, topic)`, `(ref, model)` and `(level, tag)` uniqueness          | uniqueness  | No enforcer on any side — see "Enforcement: Stage 0 only"                        |
| `MQTT.Publish(topic, …)` / `Subscribe(filter, …)` take a topic that is always `mq.Topic` | R3 | API advertises a per-call topic that never occurs — the shape that makes `width` look normal |

---

## Layer 1 — what the workflow declares

Three binding-free requirement lists (`contract/workflow.yaml`), each keyed by a logical
`id`. The type-specific config here is _intrinsic to the workflow_, not to the device.

### `Channels[]` — hardware and transport needs

| Channel type | Logical config (workflow-owned) |    Sub-address    | Pool               |
| ------------ | ------------------------------- | :---------------: | ------------------ |
| `GPIOIN`     | `bias`, `debounceMs`            |  `index` (line)   | DeviceManifest     |
| `GPIOOUT`    | —                               |  `index` (line)   | DeviceManifest     |
| `ADC`        | —                               | `index` (channel) | DeviceManifest     |
| `DAC`        | —                               | `index` (channel) | DeviceManifest     |
| `PWM`        | `frequency`                     | `index` (channel) | DeviceManifest     |
| `UART`       | —                               |         —         | DeviceManifest     |
| `CAMERA`     | `width?`, `height?` (deviation) |         —         | DeviceManifest     |
| `MQTT`       | `topic`                         |         —         | ExternalResources  |
| `LOG`        | `level`, `tag?`                 |         —         | — (implicit: the ambient logger) |

### `Models[]` — declared models

| Model type | Logical config          |       Sub-address       | Pool                          |
| ---------- | ----------------------- | :---------------------: | ----------------------------- |
| `LLMModel` | `label`, `capabilities` | `model` (upstream name) | ExternalResources.Providers   |
| `MLModel`  | `label`                 |  `model` (served name)  | ExternalResources.MLInference |

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

The split across all three lists is deliberate: `frequency`, `bias`, `topic` and
`capabilities` describe _the workflow's intent_ and travel with it everywhere. The
physical pin, the broker URL, the inference endpoint are _environment facts_, supplied
separately. (`width`/`height` are listed above because the contract carries them today,
not because they belong — per R3 they are node arguments.)

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

| Layer 1 requirement  | Pool (Layer 2)                             | Discriminator     | Lives in | ids : ref | Unique by              |
| -------------------- | ------------------------------------------ | ----------------- | -------- | :-------: | ---------------------- |
| `GPIOIN` / `GPIOOUT` | `DeviceManifest.gpios`                     | `index` (line)    | mapping  |  **N:1**  | `(ref, index)`         |
| `ADC`                | `DeviceManifest.adcs`                      | `index` (channel) | mapping  |  **N:1**  | `(ref, index)`         |
| `DAC`                | `DeviceManifest.dacs`                      | `index` (channel) | mapping  |  **N:1**  | `(ref, index)`         |
| `PWM`                | `DeviceManifest.pwms`                      | `index` (channel) | mapping  |  **N:1**  | `(ref, index)`         |
| `UART`               | `DeviceManifest.serials`                   | —                 | —        |  **1:1**  | `ref`                  |
| `CAMERA`             | `DeviceManifest.cameras`                   | `width`, `height` — *deviation, see R3* | workflow |  **N:1**  | `(ref, width, height)` |
| `MQTT`               | `ExternalResources.MQTTs`                  | `topic`           | workflow |  **N:1**  | `(ref, topic)`         |
| `LOG`                | — (implicit: the ambient logger)           | `level`, `tag`    | workflow |  **N:1**  | `(level, tag)`         |
| declared `LLMModel`  | `ExternalResources.Providers`              | `model`           | mapping  |  **N:1**  | `(ref, model)`         |
| declared `MLModel`   | `ExternalResources.MLInference`            | `model`           | mapping  |  **N:1**  | `(ref, model)`         |
| `VectorDatabase`     | — (`ref` _is_ the collection id)           | —                 | —        |  **1:1**  | `ref`                  |
| catalog model id     | `ExternalResources.Providers`, by identity | **no entry**      | —        |     —     | resolved by llmproxy routing, not bound |

### The rule

One rule generates the whole table:

> **A requirement is always unique by `(ref, discriminator)`. `ids : ref` is N:1 if and
> only if a discriminator exists — 1:1 when none does.**

That is what a discriminator is *for*: it is what makes N:1 routing to one `ref` safe, by
telling two requirements on the same resource apart. `UART` and `VectorDatabase` are 1:1
for the same single reason — they have nothing to discriminate on, so a second
requirement on that `ref` would be indistinguishable from the first.

Uniqueness is not about whether a second claimant would *break* something. It is the
design rule: one requirement, one thing. Two channels on one `(ref, index)`, two models
on one `(ref, model)`, two channels on one camera at the same size — all are the same
requirement declared twice, and the right expression is one requirement with several
subscriber nodes (as `channel.UART`'s `Broadcaster` already does).

### Where the discriminator lives

The mapping or the channel, decided by R4 (logical vs. deployment fact), with **no bearing
on cardinality** — see "The model" above. What a discriminator may be at all is R3's test:
it must name something that exists independently of a request. `bias` and `frequency` are
neither address nor argument but **setup config for an address already owned**, which is
why they sit on the channel and identify nothing.

The corollary matters for correctness: a workflow-fact discriminator must **not** be
pushed down into the Layer 2 config. Two requirements differing only by discriminator must
still resolve to one `ref` — otherwise they become two refs, two configs, and two opens of
one device.

### Enforcement: Stage 0 only

**No uniqueness constraint can live in the workflow builder** — not by omission, but
because `(ref, discriminator)` is not complete until the `ref` is bound. Two `MQTT`
channels on topic `alarm` are perfectly legal until they land on the same broker; two
camera channels at 640×480 are legal until they land on the same camera. Uniqueness is a
property of the **binding**, never of the workflow. Stage 0 is the first place both
halves are known, and therefore the only place the check can run.

The engine does not re-check either, and would let the last claimer win. Two `UART`
channels on one port both call `WatchRead`, which _"installs onLine as the permanent line
callback, **replacing any prior callback**"_ and returns nil — so one channel's
subscribers silently stop firing, and which one loses depends on map iteration order in
`SetupAll`.

Today only the `index` families and `UART` are actually enforced, by
`hardwareConflicts` over `hardwareAddressKey` (`ts/workflow-cli/cli/deploy/spec.ts`),
which keys `family:dev:index` — or `serial:dev`, because the path _is_ the device.

> **Gap:** `(ref, topic)`, `(ref, model)` and `(level, tag)` have no enforcer on any side.
> Any resolver — this CLI, fh-backend's, anything hand-authoring a mapping — owns all of
> these checks, because neither the builder nor the engine can.

A second gap sits underneath: uniqueness is over the **ref**, but a device's exclusivity
is over its **path**. Refs are content-addressed, so two camera bindings on one
`/dev/video0` differing only in `warmupFrames` hash to two refs, satisfy every check, and
race for a single-open node. The fix is the `hardwareAddressKey` pattern extended to
camera — key on device identity (`v4l2` → `device`, `libcamera` → `cameraName`), which
catches this and "two channels, one camera" with one check.

### The invariants

| Edge                        |  Cardinality  |                                                                    |
| --------------------------- | :-----------: | ------------------------------------------------------------------ |
| requirement → mapping entry |    **1:1**    | every declared id has exactly one; a missing one is a boot failure |
| requirement → `ref`         | **N:1 / 1:1** | N:1 exactly when a discriminator exists — **never 1:N**            |
| `ref` → Layer 2 config      |    **1:1**    | a ref is a key in exactly one pool                                 |
| `ref` → Layer 3 object      |    **1:1**    | opened once at boot; the handle is shared by all N                 |

**Nothing fans out.** A logical id resolves to exactly one `ref` and one live object;
there is no 1:N edge anywhere in the join. Sharing only ever runs the other way — N
requirements collapsing onto one resource, told apart by their discriminator — which is
what makes the `ref` a sharing identity rather than a name.

The pool a `ref` resolves against is **not stored in the binding**. It is implied by the
_type of the workflow resource_ carrying that id, per the table above.

### Catalog models are the exception

A mapping entry exists only for _declared_ resources. A catalog model — a built-in id
referenced from an agent node, never declared — is resolved by **identity**, not by name:
the config lists its provider as an `ExternalResources.Providers` entry, and the llmproxy
routes the model id to that provider at runtime by matching the provider's built-in
`AvailableModels`. So a catalog provider appears in `Providers` with **no `ref` pointing
at it**.

> The rule: declared resources are bound _by name_ (a mapping entry); catalog models are
> resolved _by identity_ (llmproxy routing).

> **Completeness is enforced at build (boot), not at runtime.** A requirement with no
> mapping entry, an addressable one with a nil `index`, or a `ref` with no config are all
> hard build failures — see "Validation" below. Silent degradation would hide config bugs
> until a node fires hours later.

---

## Layer 2 — the two config sources

Both arrive together in the single `EngineConfig` read at boot. They are separate
artifacts because of **different ownership, not different lifecycles**.

### DeviceManifest — device-owned

The hardware physically present on this device. A fact about the box: Ranger fills it
from what it knows the device has, and a different workflow on the same device sees the
same manifest.

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

### ExternalResources — environment-supplied

The network/service environment the device does not own.

| Pool          | `ref` ─► config                                                         | `type`          |
| ------------- | ----------------------------------------------------------------------- | --------------- |
| `MQTTs`       | `{brokerUrl, clientId?, publishPrefix, subscribePrefix, will?}`         | `mqtt`          |
| `Providers`   | `{url, bearer?}` — an endpoint the llmproxy doesn't ship                | `selfhostedLlm` |
| `Providers`   | `{provider}` — a built-in catalog provider served with an API key       | `localLlm`      |
| `Providers`   | `{provider}` — the same catalog provider proxied to the backend, no key | `backendLlm`    |
| `MLInference` | `{url}`                                                                 | `ml-inference`  |

`ExternalResourceConfig` is a tagged union discriminated by `type`; new external-resource
kinds extend that `oneOf`. Only `selfhostedLlm` carries a `url`; only `localLlm` /
`backendLlm` carry a `provider`. A catalog provider's served models are its built-in
`AvailableModels`, so they are not listed here.

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

## Layer 3 — the registries that produce code

Each pool has a registry mapping `ref` → a live implementation, and **all are built once
at boot**. `cmd/engine/main.go` owns the driver and transport registries for the process
lifetime and injects them into `build.Builder`; `Builder.Build` composes the rest. Both
`Registry` types follow the same discipline: open everything up front, and on partial
failure close what was opened, so callers never see a half-built registry.

| Layer 2 pool                    | Registry             | `ref` ─► live object                                                                     | Opened                            |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- | --------------------------------- |
| `DeviceManifest.*`              | `driver.Registry`    | `GPIODriver` / `ADCDriver` / `DACDriver` / `PWMDriver` / `SerialDriver` / `CameraDriver` | one per manifest entry, in `main` |
| `ExternalResources.MQTTs`       | `transport.Registry` | `MQTTTransport` (paho conn)                                                              | one per entry, in `main`          |
| `ExternalResources.Providers`   | `llmproxy.Client`    | `Provider`                                                                               | one per entry, in `build/llm.go`  |
| `ExternalResources.MLInference` | — (`build/ml.go`)    | `mlEndpoint`                                                                             | one per declared model            |

`driver.Registry` is **typed per family**, so a miswired manifest (a GPIO id looked up as
an ADC) fails at registration, not first use:

```go
func (r *Registry) GPIO(id string)   (GPIODriver, error)
func (r *Registry) ADC(id string)    (ADCDriver, error)
func (r *Registry) DAC(id string)    (DACDriver, error)
func (r *Registry) PWM(id string)    (PWMDriver, error)
func (r *Registry) Serial(id string) (SerialDriver, error)
func (r *Registry) Camera(id string) (CameraDriver, error)
```

A driver's transport is its own business: some open a device node, some speak HTTP to a
co-deployed component. That difference is invisible above this layer — callers see a
driver like any other. Registration therefore does not imply reachability.

An unreachable broker at boot is a **retryable** boot failure (`boot.Retry`) so the
orchestrator can restart. `main` closes both registries (`CloseAll`) when the runner
exits.

There is **no implicit backend fallback** in `llmproxy.Client` — its providers are
exactly what `ExternalResources.Providers` declares. The provider for a chat call is
resolved implicitly from the **model id**, matched against each provider's
`AvailableModels`; there is no client-level default.

---

## Tracing the join

`buildChannels` (`go/engine/build/channel.go`) is where Layer 1 meets Layer 2. For each
declared channel, by type:

```
GPIOIN "door_sensor"                                    ← addressable
  ├─ addressFor(rm, "door_sensor")   → ResourceAddress{ref:"gpiochip0", index:17}
  ├─ indexFor(b, "door_sensor")      → 17                     (nil index = error)
  ├─ drivers.GPIO("gpiochip0")       → GPIODriver             (not registered = error)
  └─ &channel.GPIOInput{Driver, Line:17, Bias, DebounceMs}    ← workflow-owned config

CAMERA "front_door"                                     ← configured leaf, no index
  ├─ addressFor(rm, "front_door")    → ResourceAddress{ref:"video0"}
  ├─ drivers.Camera("video0")        → CameraDriver           (not registered = error)
  └─ &channel.Camera{Driver, Width, Height}                   ← workflow-owned config

MQTT "alarm"                                            ← external pool
  ├─ addressFor(rm, "alarm")         → ResourceAddress{ref:"site-broker"}
  ├─ ext.MQTTs["site-broker"]        → MQTTConfig              (missing = error)
  ├─ transports.MQTT("site-broker")  → MQTTTransport
  └─ &channel.MQTT{Transport, Topic, PublishPrefix, SubscribePrefix}
```

Same three moves every time: resolve the address, resolve the `ref` against its pool,
attach the workflow-owned config. `buildCollections` and `buildDeployML` resolve declared
`VectorDatabase`s and `MLModel`s through the same `addressFor`.

Nodes look up their linked channel in the per-build typed `channels` registry by logical
id and hold the pointer; every node referencing the same id shares one instance, so
subscriber lists and driver reservations stay consistent. `SetupAll()` then runs after
all nodes are built, applying each channel's accumulated requirements to its driver once.

### Validation (boot-time, fail-fast)

| Failure                                               | Where                         |
| ----------------------------------------------------- | ----------------------------- |
| channel id has no mapping entry / empty `ref`         | `addressFor` (`channel.go`)   |
| addressable channel has nil `index`                   | `indexFor` (`channel.go`)     |
| hardware `ref` not in driver registry                 | `drivers.GPIO/ADC/Camera/...` |
| MQTT `ref` not in `ext.MQTTs`                         | `buildChannels` MQTT arm      |
| declared model not bound by the mapping               | `selfHostedEndpoints`         |
| declared model bound to a `ref` with no config        | `selfHostedEndpoints`         |
| declared model bound to a non-self-hosted provider    | `selfHostedEndpoints`         |
| unknown catalog provider id (`localLlm`/`backendLlm`) | `buildProviders`              |
| `backendLlm` provider but no backend configured       | `buildProviders`              |
| ML model unbound / `ref` has no ml-inference config   | `buildDeployML` (`ml.go`)     |
| agent node references an unservable model             | `validateModelsResolvable`    |
| `VectorDatabase` id has no mapping entry              | `buildCollections`            |

Every one exits the engine at boot (`boot.Fail`), so Ranger sees a failed container
rather than a workflow that silently misbehaves.

---

## Designing a deploy wizard

The three layers map almost directly onto wizard stages. The wizard's job is to produce a
complete **`ResourceMapping` + `ExternalResources`** for a given workflow against a given
device/environment.

1. **Read the requirements (Layer 1).** Parse `Channels[]`, `Models[]`, and declared
   `VectorDatabase`s, **plus the catalog model ids referenced by agent nodes** (walk the
   nodes — these aren't declared anywhere else). This is the exact, finite checklist: one
   row per channel, per declared model, per declared collection, and per distinct catalog
   _provider_ the referenced models resolve to.

2. **Offer bindings from the right pool (the join).** Candidate `ref`s come from the
   type-specific pool named in the mapping table above: device-owned requirements draw
   from the `DeviceManifest` families (read-only ground truth — the operator picks what
   the device has rather than typing a path); environment-supplied ones draw from
   existing/new external definitions.

   Collect the `index` / `model` sub-address only where the mapping carries one.
   **Surface sharing explicitly**: many requirements may pick the same `ref`, and that is
   the intended way to express one physical resource serving several logical needs.

   Then **enforce uniqueness over `(ref, discriminator)`** — including the workflow-fact
   discriminators (`topic`, `level`/`tag`), which the builder cannot check because it does
   not know the `ref`. A resolver is the only place both halves are known; see
   "Enforcement" under the join.

   Catalog providers aren't _bound_ — instead offer a per-provider **routing choice**:
   serve it with a local API key (`localLlm`) or route it to the backend (`backendLlm`).

3. **Collect configs for newly-referenced resources (Layer 2).** Any `ref` the user picks
   that isn't device-owned needs an `ExternalResources` entry, per the Layer 2 table.
   Device-owned refs need nothing — their config is already in the device manifest.
   Secrets go to the mounted secret document keyed by `ref` (per component — each gets
   only its own), never into the config.

4. **Validate before submit.** Re-run the boot-time checks client-side so the user fixes
   gaps in the wizard, not via a failed container. The "Validation" table is the
   authoritative checklist.

5. **Emit the config.** The output is exactly the binding half of an `EngineConfig`:
   `{ mapping, externalResources }`, joined with the workflow and device manifest and
   shipped to the device (and the secret document out-of-band).

**Design implication:** the wizard only ever authors **Layer 2 facts and the join**. It
treats the `DeviceManifest` as read-only ground truth (what hardware exists) and the
workflow as a read-only requirement list (what's needed); everything it writes is the
binding between them plus the environment-supplied external configs. Layer 3 is entirely
the engine's concern at boot — the wizard never touches it.
