# Camera rework

The camera was the only device-owned hardware ForestHub reaches through a separate
container. That fact leaked into the resource model, and the camera ended up
classified as an **external resource** — an environment-supplied endpoint, like an
MQTT broker — when it is nothing of the sort.

**Phase A fixed the classification** and is done; this doc records what changed and
why, because the reasoning is easy to lose and expensive to re-derive. For what the
model *is* now, read `workflow-deployment-layers.md` — this is the rationale, not the
reference. **Phase B (capture efficiency) is deferred**; it is a separate concern that
survives Phase A untouched.

---

## Why: four defects, one root cause

The root cause was that **packaging silently became the classifier**. `ExternalResources`
is documented as *environment-supplied facts*, and the manifest as *device-owned* — the
axis is **ownership, not lifecycle**. But camera was the first device-owned thing shipped
out-of-image, and "not in the engine image" got treated as "not the device's". Everything
below followed from that one slip.

**1. The workflow's logical id was on the wire.** `build/camera.go` sent the channel id
as the `/capture?name=` selector:

```go
endpoints[ch.Id] = &captureEndpoint{ client: client, name: ch.Id, ... }
```

Every other resource resolves logical id → `ref` (+ optional sub-address). Camera
skipped the join: `ref` picked only the URL, and the physical camera was selected by a
Layer 1 name punching through to a Layer 2 key. `engine.yaml` entrenched it — the
`model` sub-address was documented as *"omitted for driver/mqtt/camera bindings"*. So
renaming a channel broke the deployment, and it only worked at all because
`refs.alloc(\`camera:${ch.id}\`, basename(ch.id))` happened to derive the ref from the
channel id — the first `alloc` collision would have turned every capture into a silent
404.

**2. The `ExternalResources` entry carried zero information.**

```ts
externalResources[ref] = { type: "camera", url: `http://${cameraComponentServiceName()}:${CAMERA_COMPONENT_PORT}` };
```

Both are compile-time constants from `component-constants.json`, and the component is a
documented singleton. A constant, dressed as a resolved config, duplicated once per
channel. It sat there not because anything was environment-supplied, but because that
was the only pool on offer.

**3. The component's config was keyed by channel id.** The renderer *did* generate it
(`camerasJson()`); it keyed each entry by `ch.id` — defect 1 seen from the renderer's
side, so both ends agreed with each other and both encoded the violation. The
consequence: the component's config was **workflow-specific rather than
device-specific**. The same sensor got a different key per workflow, and two workflows
on one box could not describe it consistently.

**4. The config was a driver recipe, not a hardware fact.** `CameraSource.device` held
GStreamer pipeline syntax (`strings.Fields` split it into tokens, so
`"rtspsrc location=… ! rtph264depay ! avdec_h264"` was legal), and `setup` ran through
`/bin/sh -exc`.

---

## What Phase A changed

### The camera is a hardware fact

`DeviceManifest.cameras` now holds the box's cameras, and the `camera` arm is **deleted**
from `ExternalResourceConfig` — which killed the `CameraConfig` name collision for free.
A `CAMERA` channel's `ref` resolves against the manifest, one pool, like every other
hardware channel, and `/capture?name=` carries that **ref**. Defects 1 and 2 both die
here: the ref is a device fact on both ends, so no sub-address is needed, and there is no
URL left to store.

That the driver runs out-of-process is now purely a Layer 3 packaging detail. The engine
reaches it at a constant address (`component.Camera` / `component.CameraPort`) — nothing
points at it, and no operator supplies anything.

The wizard also finally has a pool to offer. It used to say camera candidates come from
*"existing/new capture-component endpoints"*, i.e. the operator typed `/dev/video0` into
a form, even though Ranger provisioned the box and knew what cameras it had.

**Why no remote cameras.** An IP camera is a `kind: rtsp` entry in the manifest of the
box that reaches it — reached over the network, not deployed over it. A camera attached
to a *different* box is not a camera problem: remote GPIO is exactly as conceivable and
exactly as unsupported, because the engine's model is one engine, one box, that box's
hardware. The answer there is an engine on that box publishing over MQTT — already
contracted, and it survives partition in a way synchronous remote capture doesn't. If
that's wrong, the cost is one additive contract change; the driver interface doesn't
move, because both arms are an HTTP client either way.

### Config declares intent; the component owns the recipe

`CameraSource` is a union discriminated by `kind` — `v4l2`, `libcamera`, `rtsp`, `http`,
`raw`, `debug` — carrying only *which camera, reached how*. The recipe per kind lives in
`camera/source_gstreamer.go` (`sourceArgs`). This is what makes the classification
*correct* rather than merely tidier: without it the manifest would contain GStreamer
syntax and shell scripts, and "device-owned" would be a lie.

**The kinds are access paths, not form factors.** The first cut used `usb`/`csi` and was
wrong: a CSI sensor is v4l2 on boards that expose a preconfigured node and libcamera on
boards that don't, so the form factor cannot determine a pipeline — and determining the
recipe is the entire job of the kind. The access path can, and `v4l2`/`libcamera` are
*platform* facts (like `/dev/gpiochip0`), not GStreamer vocabulary, so the manifest stays
device-owned.

**This is not an llmproxy-style provider abstraction, deliberately.** llmproxy earns its
adapters because Anthropic/OpenAI/Gemini have incompatible protocols with no common
substrate. GStreamer *is* that substrate. What the component absorbs is **element
selection**, not protocol knowledge, so each adapter is a few lines and `decodebin`
handles codec negotiation:

```
v4l2      → v4l2src device=…
libcamera → libcamerasrc [camera-name=…]
rtsp      → rtspsrc location=… [user-id/user-pw] ! decodebin
http      → souphttpsrc location=… [user-id/user-pw] ! decodebin
raw       → <fragment, verbatim>
```

What this bought: the manifest stopped depending on fh-camera's syntax (swapping the
driver is no longer a manifest migration); the RCE surface shrank to `kind: raw` and
`setup`; and credentials got a structured home instead of a password embedded in a URL
inside a pipeline string inside a versioned device fact.

### `CameraSource` lives in `camera.yaml`; `engine.yaml` `$ref`s it

The first cut had this backwards, reasoning "the manifest is the source of truth". That
conflates **authority over the data** with **ownership of the type**: the manifest is
authoritative about *which cameras exist*; fh-camera decides *what a kind means*, and
adding one is a camera-component change the engine never notices.

The decisive argument is dependency direction — the same one that dissolved the shared
`mapping` package. The engine already imports `cameraapi` (it *is* the client), so
`engineapi → cameraapi` is free. The other direction invented a fresh dependency that
made the driver component's generated package drag in the entire engine and workflow api
surface.

### The engine side: a driver, not an endpoint

`driver.Registry` owns it alongside `GPIO`/`ADC`/`Serial`:

```go
func (r *Registry) Camera(id string) (CameraDriver, error)
```

`build/camera.go` and its endpoint map are gone. `buildChannels` builds a
`channel.Camera{Driver}` in the same switch as every other hardware channel, and boot
validation became *"camera ref not in driver registry"* — the same failure shape as a
miswired gpiochip.

A camera takes **no sub-address**, which is less of an anomaly than it looks: `UART`
already resolves `ref`-only. `index` exists to pick an addressable part *inside* a bound
resource where that part has no config of its own — a gpiochip owns 40 lines, and there
is nothing to say about line 17 except its number. A camera, like a serial port, is a
configured leaf: its `CameraSource` *is* the resource, so there is nothing beneath it to
address.

It takes **no channel config either**, and `width`/`height` were the last thing to work
that out. They looked like `GPIOIN`'s `bias`/`debounceMs` — workflow-owned fields riding
on the channel — but `bias` is applied to the driver at `Setup`, while a size is an
argument to one capture. Nothing distinguishes them mechanically: both were channel
fields frozen at build and passed into a per-call API. What distinguishes them is that
`640×480` **names nothing** — no such endpoint exists on the camera; it comes into being
when you ask. So a size is a `CameraCapture` argument, and `channel.Camera` is now the
bare binding.

That makes camera **1:1**: with the sizes gone it has no discriminator, so two channels on
one camera are one requirement declared twice. The capability survives intact and reads
better — a detector at 640×480 and a snapshot at full resolution are **two capture nodes
on one channel**, not two channels. See `workflow-deployment-layers.md` ("The model"),
which this case is the worked example for.

The engine's **domain** `CameraSource` keeps only the discriminator. It reaches every
camera identically, so the capture details (device, url, credentials, warmup, setup)
never enter the engine at all — `Kind` is carried for diagnostics, never to decide
behavior.

### The component: a domain layer it lacked

`BuildSources` used to take the generated `cameraapi.CameraConfig` directly, which
brushed against the repo rule (*never let a generated type leak into domain logic*). It
was harmless only while the config held nothing sensitive and nothing kind-dependent —
both of which A2/A4 changed. It now has a domain `Camera`/`Config` and a `ToDomain`
mapping step that merges credentials at the api→domain boundary, mirroring the engine.

One structural win came free: `debug` has no `setup` field in the contract, so *"setup
commands are not supported for source debug"* stopped being a runtime check.

### Secrets: per component, ref-as-key, no schema

The engine never sees an RTSP URL — the component builds the pipeline, so it is the only
thing that needs the credential. `buildDeploymentSpec` therefore returns **one secret
document per component** instead of one flat map, and the engine cannot leak a credential
it was never given. That is an improvement independent of camera.

The mechanism was left exactly as it was, because it is tighter than it looks: wire
configs are secret-free, `secrets.json` is keyed by the **resource's own ref**, and the
`type`/`kind` is what says a credential may exist. **No `secretRef` was added** —
`spec.ts` already encodes the invariant that a credential is part of a resource's
identity (the password participates in the ref dedup key, so *"same broker, different
creds is a different resource"*). Indirection would have contradicted a decision already
made, made camera the only arm with a second convention, and bought sharing and
multi-secret support camera doesn't need.

The real limit is that ref-as-key hard-codes **one credential per resource**. It holds
because every arm needs exactly one; the day something needs two (mTLS cert + key +
passphrase), fix it *globally*. Camera is not the forcing function.

`ComponentSecrets` was dropped from the contract entirely rather than renamed. A bare
`map[string]string` has no fields to drift, so codegen bought nothing; what is contracted
is the **path** and the **keying rule**, and both already live in `component`. `Secrets`
is now one domain type there, with `component.ReadSecrets()` — which deleted
`engine.Secrets`, `camera.Secrets`, `SecretsToDomain`, and two bespoke loaders.

**Trap worth keeping:** manifest refs are device-authored; `ExternalResources` refs are
renderer-allocated. Two namespaces in one flat map can collide. Per-component documents
dissolve this — don't merge them back into one map later.

### The renderer: config by convention, no special case

The camera used to hand-roll `workspaces/camera/cameras.json` and mount it at the config
path, which forced a bespoke block in the writer. That mount was itself the anomaly:
every other component sets `DeployComponent.config` and gets `<name>-config.json` written
and mounted for free. Camera now does too — deleting `camerasJson()`, the writer's
special case, and the workspace dir (it holds no durable state). **There is no file
called `cameras.json` any more.**

Its config is the manifest's camera section for the bound channels, keyed by ref, so
defect 3 dies: device-specific, same key in every workflow. `/dev` passthrough and the
`/run/udev` mount come from the manifest too. The ref is allocated from the camera's
*identity* (`camera:${source}:${password}`), so two channels declaring the same camera
collapse onto one entry and share one driver — and renaming a channel can't move it.

### The transport stayed an HTTP server

"Driver component" is a statement about **ownership** — who issues it, who configures it,
whether an operator may point at it — not about transport. The engine doesn't spawn the
container (Ranger/compose does), so the only options were a network socket or a Unix
socket on a shared volume, and the wire was already contracted, generated, and tested.

What changed is classification, not the wire: `camera.yaml` is marked a **private wire**,
the port is never host-published, and nothing in `ExternalResources` may point at it.
`/metadata` was **kept but demoted** to diagnostic — nobody discovers cameras through it,
since the manifest is the truth and the renderer derived the component's config from it.

**Option not taken:** a Unix socket would make "engine-private" true *by construction*
rather than by convention — today a TCP listener on the compose bridge is reachable by
any container on it. Real argument, but it costs a shared volume and dev friction, and
`127.0.0.1` isn't available across containers. Revisit if the claim ever needs enforcing.

**Dropped from the plan: the `/readyz` probe at registry build.** `driver.NewRegistry` is
workflow-agnostic, but the driver component only exists when a workflow binds a camera —
so a device with manifest cameras and a workflow using none would `boot.Retry` forever on
a valid deployment. Probing only *bound* cameras needs the workflow, which the registry
doesn't have. Registration makes no network call, so an unreachable component still
surfaces at first capture. Worth fixing; needs a different seam.

### The category got a name

Every other component — onnx, llama, grafana — is independently
deployable, and that is how the repo frames the word. Camera isn't: engine-private
lifecycle, derived config, constant address, never operator-selected. Written down in the
root `CLAUDE.md` and `components/README.md` as a **driver component**, by **criterion**
rather than instance — *device-owned hardware whose driver cannot live in the engine
image* — because a category with one member doesn't defend itself, and audio capture or a
vendor SDK would join it later. Without that, someone would eventually "fix" camera back
into the standalone mould by applying the rule that *is* written down.

Also recorded: **one engine per device; its driver components are singletons of that
engine; hardware claims belong to that domain.** That invariant is what makes an
exclusive `/dev/video0` open safe. It was previously enforced by accident — a constant
service name and port that would simply collide.

---

## Phase B — capture efficiency (deferred)

Untouched by Phase A and still worth doing, but the headline is not what it looks like.
The pipeline is slow: a process spawn, caps negotiation, warmup frames, and temp files
**per frame** (the 15s `CaptureTimeout` is that, acknowledged). Most of it is forced, and
one part is defensible.

**Subprocess per frame** is the direct cost of using the CLI rather than the library —
`gst-launch-1.0` has no persistent mode. The usual justification doesn't hold: the camera
image *already ships GStreamer userland*, so CGO there costs nothing in image size, and
the engine stays lean regardless because camera is a separate image. **The actual reason
is cross-compilation** — CGO costs `GOOS=linux GOARCH=arm64` from x86 CI and buys a cross
toolchain or qemu builds. That's a real price for an edge fleet; name it as *the* reason.

**Temp files are a symptom, not a flaw.** Concatenated JPEGs on stdout have no reliable
boundary, and `num-buffers` genuinely doesn't exist on live sources like `libcamerasrc`.
Within subprocess-land, `multifilesink` + read-the-last is reasonable. Fix the
architecture or leave it alone.

**Warmup frames exist because the pipeline dies each time.** A persistent pipeline with
`appsink` would kill the spawn cost *and* the warmup cost — auto-exposure settles once,
then every capture is a buffer pull. That's the argument for `go-gst`.

But the counter is real: a persistent pipeline holds the sensor open forever, drawing
power and blocking every other user of the node. For an hourly trigger — the LLM-vision
case this is built for — spawning is *right*. **The design is coherently tuned for
infrequent capture.** Challenge the frequency assumption, not the implementation. If we
do capture every few seconds, the answer is a **lazy persistent pipeline with an idle
timeout**, not "use CGO" on its own.

### The free win, and it isn't CGO

```go
args = append(args, "!", fmt.Sprintf("video/x-raw,width=%d,height=%d", width, height))
...
args = append(args, "!", "videoconvert", ..., "!", "jpegenc", ...)
```

`video/x-raw` forces raw output. Most UVC webcams emit **MJPEG natively** — so the camera
decodes JPEG to raw and we re-encode it back to JPEG. A double transcode costing CPU and
image quality for nothing. On a Pi at 1080p that's a meaningful chunk of capture latency,
and nothing forces it: negotiate `image/jpeg` caps and pass the buffer through when the
source offers it, falling back to `videoconvert ! jpegenc` when it doesn't. RTSP-h264
must still decode — unavoidable, and fine.

**Do the passthrough fix; don't do CGO yet.** It captures much of the real-world win at
zero architectural cost and no build-pipeline change.

### While we're here

`jpegenc` is hardcoded, which makes `camera.yaml`'s *"modality-neutral… a server returns
encoded frames for its modality"* fiction. Either make the output format a config field
or stop claiming it in the contract.

---

## Still open

1. **Capture frequency** — the load-bearing assumption under all of Phase B. If
   sub-minute capture is a real target, B is not optional and the idle-timeout persistent
   pipeline is the design.
2. **`kind: raw` and `setup`** — both are RCE-by-design, fine while Ranger authors the
   manifest. If it ever becomes wizard-editable, they need gating. Now a committed
   constraint rather than an accident.
3. **Device-scoped secrets** — the transport works (`secrets[ref]`, per component), but
   the *authoring path* doesn't exist: every secret today is deploy-scoped, pulled from a
   wizard binding. An RTSP password is a fact about the device's camera and should be
   entered once per device, not once per deploy. Ranger's to build; until then, an
   authenticated `rtsp`/`http` camera has no way to receive its password.
4. **The `/readyz` probe** — dropped for the reason above; an unreachable component still
   surfaces at first capture rather than at boot.
5. **The MJPEG double transcode** — the one gratuitous cost, fixable with a caps
   negotiation and no architecture change. Highest value-per-effort left here.
