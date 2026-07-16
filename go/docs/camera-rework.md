# Camera rework

The camera is the only device-owned hardware ForestHub reaches through a separate
container. That fact leaked into the resource model, and the camera ended up
classified as an **external resource** — an environment-supplied endpoint, like an
MQTT broker — when it is nothing of the sort. This doc records why that is wrong,
what to change, and what to leave alone.

Two phases, independent and separately shippable:

- **Phase A** — reclassify the camera as a device-owned hardware fact, driven by an
  engine-private **driver component**, configured by intent rather than by
  GStreamer syntax. Do this first.
- **Phase B** — make capture itself efficient. Optional, and mostly not what it
  looks like.

---

## Where we are today

Facts, as of this writing:

- `contract/engine.yaml` has a `CameraConfig` arm in `ExternalResourceConfig`,
  carrying `{type: camera, url}`.
- `contract/camera.yaml` has a **different** `CameraConfig` — the camera
  component's boot config (nicknamed `cameras.json`), a map of name → `CameraSource`.
  The name collision is real and confusing.
- `go/engine/build/camera.go` resolves each `CAMERA` channel to a `captureEndpoint`
  holding an HTTP client.
- `go/camera` is ~350 non-test lines. It shells out to the `gst-launch-1.0` **CLI**
  (no CGO, no GStreamer bindings), one pipeline per frame, JPEGs to a temp dir via
  `multifilesink`, reads the last one, deletes the dir.
- `ts/workflow-cli/cli/deploy/spec.ts` emits the camera container and mounts
  `cameras.json` at the standard component config path.

### The four defects

**1. The logical id is on the wire.** `build/camera.go` sends the workflow's channel
id as the `/capture?name=` selector:

```go
endpoints[ch.Id] = &captureEndpoint{ client: client, name: ch.Id, ... }
```

Every other resource resolves logical id → `ref` (+ optional sub-address). Camera
skips the join: `ref` picks only the URL, and the physical camera is selected by the
Layer 1 logical name punching through to a Layer 2 config key. `engine.yaml`
entrenches this — the `model` sub-address is documented as *"omitted for driver/mqtt/
camera bindings."* Consequences: renaming a channel breaks the deployment; the
component's config becomes workflow-specific rather than device-specific; and it only
appears to work because `refs.alloc(\`camera:${ch.id}\`, basename(ch.id))` happens to
derive the ref from the channel id. The first `alloc` collision that renames a ref
turns every capture into a silent 404.

**2. The `ExternalResources` entry carries zero information.** For an on-device
camera, `spec.ts` writes:

```ts
externalResources[ref] = { type: "camera", url: `http://${cameraComponentServiceName()}:${CAMERA_COMPONENT_PORT}` };
```

Both are compile-time constants from `contract/component-constants.json`, and the
camera component is a documented singleton. So this is a constant, dressed as a
resolved config, duplicated once per channel. It sits in `ExternalResources` not
because anything about it is environment-supplied, but because that was the only pool
on offer.

**3. `cameras.json` is keyed by the workflow's channel id.** The renderer does generate
it — `camerasJson()` in `generate.ts:169` builds one entry per on-device camera from
the wizard binding (`source`, `device`, `warmupFrames`, `setup`) and `write.ts` emits
it. But it keys each entry by the **channel id**:

```ts
for (const [id, b] of Object.entries(cfg.cameras)) {   // id is the workflow channel id
  if (b.location === "device") { ...; cameras[id] = entry; }
}
```

which is defect 1 seen from the renderer's side: Go sends `ch.Id` as the `/capture`
selector, TS keys the config by the same `ch.id`, so the two agree with each other and
both encode the violation. The consequence isn't a missing file — it's that the
component's config is **workflow-specific rather than device-specific**: the same
physical camera gets a different config key per workflow, renaming a channel rewrites
the device's capture config, and two workflows on one box cannot describe the same
sensor consistently.

**4. The config is a driver recipe, not a hardware fact.** `CameraSource.device`
holds GStreamer pipeline syntax — `strings.Fields(cc.Device)` splits it into pipeline
tokens, so `"rtspsrc location=… ! rtph264depay ! avdec_h264"` is a legal value. And
`setup: []string` runs through `/bin/sh -exc`. Both are explicitly operator-trusted.

---

## Phase A — camera as a device-owned driver component

### A1. Classification: hardware fact

A camera is hardware the box owns, exactly as much as `/dev/gpiochip0` or
`/dev/ttyUSB0`. `workflow-deployment-layers.md` already states the axis: the manifest
is **device-owned**, `ExternalResources` is **environment-supplied**, and the
distinction is *ownership, not lifecycle*. Camera was misfiled because it was the
first device-owned thing shipped out-of-image — so packaging silently became the
classifier.

```go
type DeviceManifest struct {
    GPIOs   map[string]GPIOConfig
    ...
    Cameras map[string]CameraSource   // ref ─► the box's camera
}
```

- The `camera` arm is **deleted** from `ExternalResourceConfig` in `engine.yaml`.
  This resolves the `CameraConfig` name collision for free.
- A `CAMERA` channel's `ref` resolves against `DeviceManifest.Cameras`, one pool,
  like every other hardware channel.
- `/capture?name=` carries the **ref**. Defect 1 dies: the ref is a device fact on
  both ends, and no sub-address is needed.
- The wizard finally gets a pool to offer. Today `workflow-deployment-layers.md:414`
  says camera candidates come from *"existing/new capture-component endpoints"* —
  i.e. the operator types `/dev/video0` into a form, even though Ranger provisioned
  the box and knows what cameras it has. That knowledge now has a home.

**Which cameras are remote?** None, and this is deliberate. An IP camera is not a
remote camera component — it's a `kind: rtsp` entry in the manifest of the box that
reaches it, driven by the local component. A camera physically attached to a
*different* box is not a camera problem at all: remote GPIO is exactly as conceivable
and exactly as unsupported, because the engine's model is one engine, one box, that
box's hardware. The answer there is an engine on that box publishing frames over MQTT
— already contracted, and it survives network partition in a way synchronous remote
capture does not. If we are wrong, the cost is one additive contract change (re-add
the arm, add a second pool); the engine's driver interface does not move, because both
arms are an HTTP client either way. Low regret — don't pay for the flexibility now.

### A2. Config by intent, not by recipe

This is what makes A1 *correct* rather than merely tidier. Without it, the
`DeviceManifest` contains GStreamer syntax and shell scripts — a driver recipe in one
driver's vocabulary, with two arbitrary-code-execution surfaces.

Replace the `source` / `device` pair with a **kind discriminator**:

```yaml
CameraSource:
  oneOf: [UsbCamera, CsiCamera, RtspCamera, HttpCamera, RawCamera, DebugCamera]
  discriminator: { propertyName: kind }

# usb   → { device: /dev/video0 }
# csi   → { device: <sensor selector>, setup?: [...] }
# rtsp  → { url, user? }                   password from secrets[ref]; see A4
# http  → { url, user? }                   password from secrets[ref]; see A4
# raw   → { pipeline: "<gst fragment>" }   escape hatch, explicitly operator-trusted
# debug → {}                               fixed frame, hostless CI
```

Wire configs are **secret-free**, so no arm carries a password or a `secretRef`. The
`kind` is what declares a credential may exist, exactly as `type: mqtt` does today.

The component owns the recipe per kind. This is **not** an llmproxy-style provider
abstraction, and we should not build one: llmproxy earns its adapters because
Anthropic/OpenAI/Gemini have genuinely incompatible protocols with no common
substrate. GStreamer *is* that substrate, and has been for twenty years. What we are
absorbing is **element selection**, not protocol knowledge — and GStreamer hands us
the generic answer, so each adapter is a few lines:

```
usb  → v4l2src device=…
csi  → libcamerasrc …
rtsp → rtspsrc location=… ! decodebin        # decodebin auto-negotiates h264/h265/mjpeg
http → souphttpsrc location=… ! decodebin
```

The component already does this once — the `v4l2` arm in `newGStreamerSource` is
exactly the pattern. Today there is one adapter and an escape hatch; make the
adapters the main path and keep the escape hatch as `kind: raw`, which is genuinely
valuable for odd hardware and should stay.

What this buys, beyond taste:

- The manifest declares intent, so it is a hardware fact.
- The manifest stops depending on fh-camera's syntax — swapping the driver stops
  being a manifest migration.
- The RCE surface shrinks to `kind: raw` and `csi.setup`.
- **Credentials get a structured home** (see A4), instead of a password embedded in a
  URL inside a pipeline string inside a versioned device fact.

`setup` narrows to the kinds that need it (CSI/ISP media graphs). It stays ugly, and
it stays correct: "to use this sensor you must run these media-ctl commands" is
genuinely knowledge about the box, and it has to live somewhere.

### A3. `cameras.json` becomes derived from the manifest

`camerasJson()` already generates the file; what changes is its **source and its key**.
It stops reading wizard bindings keyed by channel id and starts emitting the subset of
`DeviceManifest.Cameras` that this deployment's bound channels resolve to, keyed by
ref. Defect 3 dies: the config becomes device-specific, so the same sensor has the same
key in every workflow on the box. `/dev` passthrough and the `/run/udev` mount likewise
come from the manifest rather than the binding. Only bound cameras are emitted — the
component should not run setup scripts for sensors no workflow reads.

`camera.yaml`'s `CameraConfig` stays; it's still a cross-language seam (renderer
writes, component reads). It becomes a **projection** of the manifest.

**Where `CameraSource` lives:** define it once in `engine.yaml` beside
`DeviceManifest` and have `camera.yaml` `$ref` it. The manifest is the source of
truth; the component's config is derived from it, so the dependency should point that
way. Cross-contract refs are established (`debug.yaml` and `deployment.yaml` both ref
`workflow.yaml`).

### A4. Secrets

RTSP/HTTP cameras need credentials, and there is **no structural reason** the secrets
mechanism can't serve the manifest. The plumbing is already component-neutral:
`SecretsFile = "/etc/foresthub/secrets.json"` lives in `go/component/constants.go`,
the generic component contract, not `cmd/engine`. Only the engine currently gets one.

#### The existing mechanism, exactly

Worth stating precisely, because it is tighter than it looks and the camera arm should
not deviate from it:

- **Wire configs are secret-free.** `MQTTConfig` on the wire carries `username` but no
  password field at all. Secrets are never in the deployment spec — not rotation-safe,
  breach-exposed if stored.
- **`secrets.json` is keyed by the resource's own ref.** There is no `secretRef` field
  and no indirection: the ref *is* the key. `Password: secrets[id]`
  (`mapping/engine.go:52`), `APIKey: secrets[id]`.
- **The domain type carries the credential**, merged at the api→domain boundary
  (`mapping.ExternalResourcesToDomain`). A generated type never reaches domain logic
  holding a secret, because it never holds one at all.
- **The `type`/`kind` decides whether a secret is read.** mqtt → `Password`;
  `localLlm`/`selfhostedLlm` → `APIKey`; `ml-inference`/`camera` → none today.
- **It is implicitly optional, never validated.** *"A missing secret leaves the
  credential empty (the connection may still be valid — e.g. an anonymous broker or a
  keyless endpoint)."*

**Do not add a `secretRef` field.** `spec.ts:370` already encodes the invariant
deliberately — the password participates in the ref dedup key precisely so that *"same
broker, different creds is a different resource."* A credential is part of a resource's
identity, not an attribute it points at. Adding indirection for camera alone would
contradict a decision already made, make camera the only arm with a second convention,
and add a dangling-reference failure mode to buy sharing and multi-secret support that
camera does not need (RTSP is `user` in config plus one password).

The real limit is that ref-as-key hard-codes **one credential per resource**. It holds
today because every arm needs exactly one. The day something needs two — mTLS cert +
key + passphrase is the realistic case — the model genuinely breaks, and that should be
fixed *globally* with a considered design. Camera is not the forcing function.

So: `RtspCamera { kind, url, user? }` on the wire; password from `secrets[ref]`.

#### What actually changes

**The secret goes to the camera component, not the engine.** The engine never sees the
RTSP URL — the component builds the pipeline, so it is the only thing that needs the
credential. That means:

- `buildDeploymentSpec` stops returning one flat `resourceSecrets` map (`spec.ts:75`,
  mirrored on `EngineSecrets`) and starts returning **one per component**.
- `EngineSecrets` is misnamed under this model — it wants to be a neutral
  `ComponentSecrets`, sitting with the component contract.
- `cmd/camera` gains a `secrets.json` read, mirroring `loadEngineSecrets`.

This is an improvement independent of camera: least privilege — the engine cannot leak
a credential it was never given.

**The camera component needs a domain layer it currently lacks.** `camera.BuildSources`
takes `cameraapi.CameraConfig` — the generated type — directly, with no domain type and
no mapping step. That already brushes against the repo rule (*"never let a generated
type leak into domain logic — map it first"*); it is harmless today only because the
config holds nothing sensitive and nothing kind-dependent. Once `kind` arms carry
credentials merged from `secrets[ref]`, the component needs what the engine has: a
domain `Camera` type and a `mapping` step that performs the merge at the boundary. This
is a prerequisite for A2/A4, not an afterthought — and it is where the merge belongs.

#### The gap: device-scoped secrets have no author

This one is not structural either, but the flow genuinely does not exist.

Every secret today is **deploy-scoped**: the operator types it into the wizard, and
`buildDeploymentSpec` pulls it out of the binding into `resourceSecrets[ref]`. But the
manifest is **device-owned, read-only ground truth** — there is no binding to carry a
credential, and asking per-deployment would be wrong anyway (an RTSP password is a fact
about the device's camera, not about this workflow; it should be entered once per
device, not once per deploy).

So a manifest-declared camera credential needs a **device-scoped secret store**,
supplied by Ranger alongside the device registration and injected at render. The
transport mechanism (`secrets.json` keyed by ref) works unchanged; the *authoring path*
is new. That lands in fh-backend rather than this repo, but the contract has to
accommodate it, and it is the one part of Phase A with a genuine external dependency.
USB and CSI cameras need no credential — so this only blocks `kind: rtsp` / `kind:
http`, and the phase can ship without them.

**Trap:** manifest refs are device-authored (`gpiochip0`, `cam0`); `ExternalResources`
refs are renderer-allocated via `refs.alloc`. Two namespaces in one flat secrets map
can collide. Per-component secret documents dissolve this — don't merge them back into
one map later. Note that manifest refs also need no dedup, since the manifest author
picks them; the `refs.alloc` identity/dedup machinery applies only to the renderer's
pool.

### A5. Transport — it stays a genuine server

**Yes, keep the HTTP server.** "Sub-component" is a statement about *ownership* — who
issues it, who configures it, whether an operator may point at it — not about
transport.

The engine does not spawn the camera container; Ranger/compose does. They are two
processes on a bridge, so the only transports available are a network socket or a
Unix socket on a shared volume. Given that:

- The wire is already contracted, generated on both sides, and tested. Changing it
  buys nothing functional.
- `/readyz` is *needed*: the driver registry should probe it at boot (A6). That's a
  server feature.
- `/healthz` stays — the container runtime uses it for restart policy.
- **`/metadata` becomes dead weight.** It exists so an external consumer can discover
  what cameras a component serves. Under this model nobody discovers: the manifest is
  the truth and the engine wrote the component's config. Keep it for debugging or drop
  it, but stop treating it as part of the contract's purpose.

What *does* change is the classification, not the wire: `camera.yaml` is marked a
**private wire**, the port is never host-published (already true — it's container-side
only), and nothing in `ExternalResources` may point at it.

**Option not taken:** a Unix socket on a shared volume would make "engine-private"
true *by construction* rather than by convention — today a TCP listener on the compose
bridge is reachable by any container on it. That's a real alignment argument, but it
costs a shared volume mount and dev friction, and note `127.0.0.1` is not an option
across containers. Revisit if the privacy claim ever needs enforcing rather than
documenting.

### A6. Engine side

`driver.Registry` owns it, alongside `GPIO`/`ADC`/`Serial`:

```go
func (r *Registry) Camera(id string) (CaptureDriver, error)
```

`build/camera.go`'s endpoint map goes away. Boot validation becomes *"camera ref not
in driver registry"* — the same failure shape as a miswired gpiochip — replacing
*"camera bound to ref with no config in externalResources"* in the
`workflow-deployment-layers.md` validation table.

Constructing an HTTP client can't fail, so a camera driver would trivially "open"
while the component is still loading. Since `transport.Registry` already does
`boot.Retry` on an unreachable broker, the consistent move is to probe `/readyz` at
registry build and `boot.Retry`. That is strictly better than today, where an
unreachable camera surfaces at first capture, potentially hours in.

### A7. The category needs a name

Every other component here — ml-inference, llama-server, grafana — is independently
deployable, and that is how the repo frames the word. Camera under this model is not:
engine-private lifecycle, derived config, constant address, never operator-selected.
The engine is the **sole issuer of its sub-components**.

Write this down in `components/README.md` and the root `CLAUDE.md`, or someone will
later "fix" camera back into the standalone mould by applying the rule that *is*
written down. Name the **criterion**, not the instance: *device-owned hardware whose
driver cannot live in the engine image*. A category with one member doesn't defend
itself — but audio capture, a vendor SDK, anything CGO'd, all join it later.

Also write down the invariant that makes hardware claims safe: **one engine per
device; its sub-components are singletons of that engine; hardware claims belong to
that domain.** Today "one camera component" is enforced by accident — a constant
service name and port in `component-constants.json` that would simply collide. That's
a compose-level accident protecting a real safety property (`/dev/video0` is
typically single-open). State it as a rule.

### Phase A change list

| Area | Change |
|---|---|
| `contract/engine.yaml` | `DeviceManifest.Cameras`; define `CameraSource` (kind-discriminated); **delete** the `camera` arm from `ExternalResourceConfig` |
| `contract/camera.yaml` | `$ref` `CameraSource` from `engine.yaml`; keep `CameraConfig` as the derived projection; decide `/metadata`'s fate; mark as a private wire |
| `contract/component-constants.json` | unchanged (name + port stay constants) |
| `go/engine/driver` | `Camera(ref) → CaptureDriver`; `/readyz` probe + `boot.Retry` at registry build |
| `go/engine/build/camera.go` | deleted; the node takes a driver from the registry |
| `go/camera` | per-kind adapters replacing `source`/`device`; `kind: raw` escape hatch; domain type + `mapping` step (A4); `secrets.json` read |
| `ts/…/deploy/spec.ts` | emit derived `cameras.json` from the manifest; `/dev` + `/run/udev` from the manifest; per-component secrets; drop camera from `externalResources` |
| `workflow-deployment-layers.md` | camera moves to the DeviceManifest row; fix *"a camera is named by the capture node"* (it isn't — it's the channel id today, the ref after this); update the validation table |

---

## Phase B — capture efficiency

The current pipeline is slow: a process spawn, caps negotiation, warmup frames, and
temp files **per frame**. The 15s `CaptureTimeout` is that, acknowledged. But most of
it is forced, and one part is defensible. Separating them matters.

**Subprocess per frame** is the direct cost of using the CLI rather than the library —
`gst-launch-1.0` has no persistent mode, so there is nothing else to do. The real
question is why the CLI, and note the usual answer doesn't hold: the camera image
*already ships GStreamer userland*, so CGO there costs nothing in image size, and the
engine stays lean regardless because camera is a separate image. **The actual reason is
cross-compilation** — CGO costs `GOOS=linux GOARCH=arm64` from x86 CI and buys a cross
toolchain or qemu builds. That is a real price for an edge fleet, and it should be
named as *the* reason rather than letting "lean image" stand in for it.

**Temp files are a symptom, not a flaw.** The reasoning in the code is sound:
concatenated JPEGs on stdout have no reliable boundary, and `num-buffers` genuinely
doesn't exist on live sources like `libcamerasrc`. Within subprocess-land,
`multifilesink` + read-the-last is a reasonable answer. Fix the architecture or leave
this alone.

**Warmup frames exist because the pipeline dies each time.** This is the one worth
staring at. A persistent pipeline with `appsink` kills the spawn cost *and* the warmup
cost — auto-exposure settles once, then every capture is a buffer pull. That's the
strong argument for `go-gst`.

But the counter is real: a persistent pipeline holds the sensor open forever, drawing
power and blocking every other user of the node. If the workflow captures on an hourly
trigger — the LLM-vision case this is built for — spawning is *right*. **The design is
coherently tuned for infrequent capture.** Challenge the frequency assumption, not the
implementation. If it turns out we capture every few seconds, the answer is a
**lazy persistent pipeline with an idle timeout**: open on first capture, hold for N
seconds, tear down when idle. That gets both properties, and it's the design worth
writing if we go CGO — not "use CGO" on its own.

### The free win, and it isn't CGO

```go
args = append(args, "!", fmt.Sprintf("video/x-raw,width=%d,height=%d", width, height))
...
args = append(args, "!", "videoconvert", ..., "!", "jpegenc", ...)
```

`video/x-raw` forces raw output. Most UVC webcams emit **MJPEG natively** — so we make
the camera decode JPEG to raw, then re-encode it back to JPEG. A double transcode
costing CPU and image quality for nothing. On a Pi at 1080p that's a meaningful chunk
of capture latency, and nothing forces it: negotiate `image/jpeg` caps and pass the
buffer through when the source offers it, falling back to `videoconvert ! jpegenc`
when it doesn't. RTSP-h264 must still decode — unavoidable, and fine.

**Recommendation: do the passthrough fix, don't do CGO yet.** It captures much of the
real-world win at zero architectural cost and no build-pipeline change. Revisit go-gst
only when the capture-frequency assumption actually changes, and then build the
idle-timeout design rather than a naive always-on pipeline.

### While we're here

`jpegenc` is hardcoded, which makes `camera.yaml`'s *"modality-neutral… a server
returns encoded frames for its modality"* fiction. Either make the output format a
config field or stop claiming it in the contract. The contract should not describe a
component we haven't built.

---

## Open decisions

1. **`/metadata`** — keep for debugging, or drop as redundant under A3?
2. **`CameraSource`'s home** — `engine.yaml` (recommended: manifest is upstream) vs
   `camera.yaml` (it is the component's input vocabulary).
3. **Unix socket vs TCP** (A5) — convention vs construction. Recommend TCP now.
4. **Capture frequency** — the load-bearing assumption under all of Phase B. If
   sub-minute capture is a real target, B is not optional and the idle-timeout
   persistent pipeline is the design.
5. **`kind: raw` and `csi.setup`** — both are RCE-by-design, fine while Ranger authors
   the manifest. If the manifest ever becomes wizard-editable, they need gating. This
   is now a committed constraint rather than an accident.
6. **Device-scoped secrets** (A4) — the only part of Phase A with an external
   dependency (Ranger must author credentials against the device, not the deploy).
   Ship USB/CSI first and gate `kind: rtsp` / `kind: http` on it, or block the phase?
   Recommend the former.
