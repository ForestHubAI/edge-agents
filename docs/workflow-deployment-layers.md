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

## How Layer 2 resources get configured

Resource config lives in Layer 2, never the workflow — a different workflow on this device
sees the same fact. Whether the driver runs in
another container is **not** a fact about the resource, and must never decide its home.
Packaging is a Layer 3 detail.

Sub-resource config **cannot** live in Layer 2, and this is structural, not a convention:
Layer 2 has one entry per `ref`, while the sub-resource is chosen by the mapping, which
Layer 2 cannot see. `manifest.gpios[ref] = {chip}` has no slot for line 17's bias and
cannot have one. So it lives in something keyed by **channel id** instead.

| Config of          | Home                       | Keyed by   | Examples                                       |
| ------------------ | -------------------------- | ---------- | ---------------------------------------------- |
| the **resource**   | Layer 2                    | `ref`      | chip path, baud, broker url, camera source     |
| a **sub-resource** | the channel or the address | channel id | `bias`, `frequency`, `topic`; `index`, `model` |

Whether logical config lives on the channel or the address is decided by **logical fact vs.
deployment fact**, and nothing else. Which line a sensor is wired to, or what an operator's server
calls a model, is a fact about _this deployment_ → the address (the mapping). A topic name
is the workflow's intent → the channel.

This has **no bearing on cardinality**: `(ref, topic)` discriminates exactly as
`(ref, index)` does. Where the discriminator lives and how many ids share a `ref` are
independent questions.

Anything else a channel might carry is a **node argument** — by definition, not by
preference. Config is decided at build and fixed for the channel's life, shared by every
node bound to it. A fact that isn't config can vary from one invocation to the next, and a
channel field cannot express that.

Capture size is the worked example. Nothing configures `640×480` — no setup applies it and
no endpoint bears its name; the next capture may ask for something else. So it belongs on
`CameraCapture`, which is what makes `CAMERA` 1:1: with the sizes gone it has no
discriminator, and two sizes from one camera is two capture nodes on one channel.

---

## Layer 1 — what the workflow declares

Three binding-free requirement lists (`contract/workflow.yaml`), each keyed by a logical
`id`. The type-specific config here is _intrinsic to the workflow_, not to the device.

### `Channels[]` — hardware and transport needs

| Channel type | Logical config (workflow-owned) |    Sub-address    | Pool                             |
| ------------ | ------------------------------- | :---------------: | -------------------------------- |
| `GPIOIN`     | `bias`, `debounceMs`            |  `index` (line)   | DeviceManifest                   |
| `GPIOOUT`    | —                               |  `index` (line)   | DeviceManifest                   |
| `ADC`        | —                               | `index` (channel) | DeviceManifest                   |
| `DAC`        | —                               | `index` (channel) | DeviceManifest                   |
| `PWM`        | `frequency`                     | `index` (channel) | DeviceManifest                   |
| `UART`       | —                               |         —         | DeviceManifest                   |
| `CAMERA`     | —                               |         —         | DeviceManifest                   |
| `MQTT`       | `topic`                         |         —         | ExternalResources                |
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
separately. A `CAMERA` carries nothing at all: it takes no sub-address, and capture size
configures nothing, so it is a `CameraCapture` argument.

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

| Layer 1 requirement         | Pool (Layer 2)                   | Discriminator     | Lives in         | ids : ref | Unique by      |
| --------------------------- | -------------------------------- | ----------------- | ---------------- | :-------: | -------------- |
| `GPIOIN` / `GPIOOUT`        | `DeviceManifest.gpios`           | `index` (line)    | mapping          |  **N:1**  | `(ref, index)` |
| `ADC`                       | `DeviceManifest.adcs`            | `index` (channel) | mapping          |  **N:1**  | `(ref, index)` |
| `DAC`                       | `DeviceManifest.dacs`            | `index` (channel) | mapping          |  **N:1**  | `(ref, index)` |
| `PWM`                       | `DeviceManifest.pwms`            | `index` (channel) | mapping          |  **N:1**  | `(ref, index)` |
| `UART`                      | `DeviceManifest.serials`         | —                 | —                |  **1:1**  | `ref`          |
| `CAMERA`                    | `DeviceManifest.cameras`         | —                 | —                |  **1:1**  | `ref`          |
| `MQTT`                      | `ExternalResources.MQTTs`        | `topic`           | workflow         |  **N:1**  | `(ref, topic)` |
| `LOG`                       | — (implicit: the ambient logger) | `level`, `tag`    | workflow         |     —     | —              |
| catalog/declared `LLMModel` | `ExternalResources.Providers`    | `model`           | mapping / static |  **N:1**  | `model`        |
| declared `MLModel`          | `ExternalResources.MLInference`  | `model`           | mapping          |  **N:1**  | `(ref, model)` |
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

### Where the discriminator lives

The channel or the address, decided by logical vs. deployment fact — see "The model"
above, and note it has **no bearing on cardinality**. `bias` and `frequency` are
sub-resource config that identifies nothing: they configure an address already owned, so
they sit on the channel without discriminating.

The corollary matters for correctness: a workflow-fact discriminator must **not** be
pushed down into the Layer 2 config. Two requirements differing only by discriminator must
still resolve to one `ref` — otherwise they become two refs, two configs, and two opens of
one device.

Enforcement is split by _who authored the mapping_: the deploy resolver checks the
mapping it built; the engine defends the invariant the mapping stands for.

**The resolver owns the uniqueness check.** The rule is executable and canonical:
`uniquenessKey` + `bindingConflicts` (`workflow-core`'s `deploy` module) are the one table
every deploy path agrees on. `uniquenessKey` maps a filled `Requirement` to the string
identifying the resource it claims; two ids sharing a key are the same claim declared
twice. Both resolvers run it off the shared function — the OSS CLI (`spec.ts`) and the
backend, each supplying its own binding shape.

The flow is **derive → fill → check**. `workflowBindingRequirements` derives a
`Requirement` per id carrying only workflow facts (`family`, `topic`); the consumer fills
the deployment holes (`ref`, `index`, served `model`) from its own binding representation;
then `bindingConflicts` groups by key. Order matters: completeness runs **first** — a
required field still `null` makes `uniquenessKey` throw, never silently skip, so an
unfilled requirement can't masquerade as "no conflict."

**No uniqueness constraint can live in the workflow builder**, because `(ref, discriminator)`
is not complete until the `ref` is bound: two `MQTT` channels on topic `alarm` are legal
until they land on one broker; two cameras until they land on one device. Uniqueness is a
property of the **binding**, not the workflow. It lives in `workflow-core` — but as a pure
function over `(workflow-derived requirement, binding)`, not in the builder's editor state,
so there is no contradiction.

**The engine does not re-run this check.** It has no Go twin of `bindingConflicts`: a
second `(ref, discriminator)` pass would duplicate the resolver and still not see the real
hazard (content-addressed refs, a physical device path). Instead the engine defends the
invariant _at the point of claim_ — a driver or transport that already holds an exclusive
resource **rejects a second claimant with an error at `Setup`** rather than silently
overwriting. That catches a mapping the resolver did not author (hand-edited, third-party)
where it actually matters, regardless of how the duplicate arose, and needs no knowledge of
the uniqueness table. (This is the reason `checkEndpointUniqueness`, the old MQTT-only
pre-check, was removed.)

> The driver-side rejection is the standing rework: today several still overwrite the last
> claimer silently — `serial_impl.go`'s `WatchRead` replaces the prior callback and returns
> nil (which channel loses depends on `SetupAll` map order); `gpio_linux.go`'s `replaceLine`
> tears down the prior request; the paho route table overwrites by filter. Each must return
> an error on a second claim instead.

**Two constraints sit outside this split:**

- **LLM global namespace.** `LLMModel` is unique by served `model` across _all_ providers,
  not per-`ref` (see "The rule" — Layer 3 drops the ref). `uniquenessKey` emits the `llm:`
  key for both `declaredLlm` and `catalogLlm` so a self-hosted name shadowing a catalog id
  is caught at deploy; the engine enforces the same at boot, where `llmproxy.NewClient`
  rejects a model id served by two providers — its provider map is the "point of claim" for
  models, so this is the same driver-side discipline, not a re-run of the table.
- **Camera device injectivity.** `uniquenessKey` catches two ids on one camera _ref_. Its
  other hazard — two _refs_ on one physical `/dev/video0`, which content-addressed refs can
  manufacture (two bindings differing only in `warmupFrames` hash to two refs) — needs the
  device path, not the ref, so it is a check over the assembled `DeviceManifest.cameras`
  (`v4l2` → `device`, `libcamera` → `cameraName`; network kinds have none), not part of
  this function.

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

CAMERA "front_door"                                     ← no discriminator, no config
  ├─ addressFor(rm, "front_door")    → ResourceAddress{ref:"video0"}
  ├─ drivers.Camera("video0")        → CameraDriver           (not registered = error)
  └─ &channel.Camera{Driver}                                  ← size is a node argument

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
| one model id served by two providers                  | `llmproxy.NewClient`          |
| MQTT channel with an empty `topic`                    | `channel.MQTT.Setup`          |
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
   not know the `ref`; see "Enforcing uniqueness" under the join.

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
