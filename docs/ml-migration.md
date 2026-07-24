# ML rework

The ML component (service `onnx`, image `fh-onnx`; its wire is the `ml` contract) was the
last component still living by convention. It had no boot config, discovered its models by
scanning a directory, and returned an opaque `result` blob the engine could not type. None
of that was wrong the way camera's classification was wrong — it was under-specified, and
the gaps were about to matter as the component grew a second input modality and
cloud-provider ambitions.

**Phases A and B are done** and recorded here; the reasoning is easy to lose and expensive
to re-derive. For what the model _is_ now, read `workflow-deployment-layers.md` and
`component-contract.md` — this is the rationale, not the reference. **Phase C (declarative
preprocessing) is deferred**, and the deferral is the point: it is only worth building
under conditions that do not hold yet.

---

## Phase A — a boot config, in the contract

### Why: config-by-directory-scan is a seam refusing to be one

The renderer already knew the model set — `write.ts` pre-created one bundle directory per
device model. Then the component threw that knowledge away and _rediscovered_ the same set
by scanning the workspace at startup. Producer and consumer communicating through `mkdir`:
no declared shape, no validation, and an empty directory was a silent success rather than a
named failure.

That is a **cross-language seam** by the root `CLAUDE.md` criterion — two independent
renderers (the OSS TS one in `spec.ts`, and the closed `fh-backend` renderer) must produce a
config the Python component consumes. A shape crossing a seam gets a contract type. It had
none, so `fh-backend` had nothing to codegen against and would have had to _know_ the
component's scan behavior to emit a working deployment — the exact drift the contract exists
to prevent.

### What changed

`MLConfig` / `MLModelConfig` were added to `contract/ml.yaml`: the model
set the component is issued, keyed by bundle id, each with optional deployment `params`
overrides. The renderer writes it as the component's `config` blob, so it rides the generic
`<name>-config.json` mechanism (`write.ts` mounts it at the contracted config path) with
**no special case** — exactly as camera's `CameraConfig` does.

The config is **authoritative**, which was the one real behavior decision. `repository.py`
now loads exactly the declared bundles: a declared bundle that is missing or unloadable is a
permanent boot failure (exit 78), and an undeclared sub-folder in the workspace is ignored,
never loaded implicitly. Staging a bundle on the device is no longer enough to serve it — the
deployment must bind a model to it, which is what puts it in the config. That turns a
silently-empty deployment into a boot error at the device, not a mysterious 404 at the
engine's first inference.

### What did NOT change, deliberately

**`manifest.yaml` stays out of the contract.** A bundle's manifest — handler binding, model
file, default params — is authored beside the weights and read by exactly one implementation.
No seam, so it stays a domain type owned by Python's `Manifest`, documented in `bundles.md`,
not the contract. The split is: `config.json` says _which_ models load and what the
deployment overrides; `manifest.yaml` says what one model _is_. Moving handler bindings into
`config.json` would make the renderer responsible for each model's internals, which it has no
business knowing.

**`secrets.json` was not added.** the ML component is contracted as a credential-free trusted
in-deployment endpoint. An unused reader would be speculative.

**The `ML_MODELS_DIR` env override was deleted.** The workspace path is a contract constant —
the renderer's bind-mount target — and `component-contract.md` says a component reads the
fixed path, _"never an env-tunable location"_. The Dockerfile comment claiming "no override
set" was an admission someone knew. Three stale docs pointing at `/var/lib/foresthub/models`
(the constant is `.../workspace`) were corrected in the same pass.

---

## Phase B — task-shaped results

### Why: an opaque blob is unusable above the wire

`InferResult.result` was `additionalProperties: true` — "shape defined by the handler, not
this contract". That made three things impossible: a typed workflow node consuming the
result, a deploy-time check that a node's expectations match the model, and any cloud
provider slotting in behind a common shape. Task level is the **only** level where inference
normalizes across implementations — two object-detection models return the same shape however
different their architecture — and it is exactly where Hugging Face and everyone else draws
the line.

### What changed

`contract/ml.yaml` gained a `Task` enum (`object-detection`, `image-classification`,
`tensor`) and a discriminated `InferenceResult` union — `DetectionResult`,
`ClassificationResult`, `TensorResult` — replacing the opaque object. `task` was added to
`ModelMetadata`, so `/metadata` advertises what a model does without an inference call. Boxes
are `xmin/ymin/xmax/ymax` in **original-image pixels**: the decoder projects out of whatever
letterboxed space the model worked in, so a consumer never needs the preprocessing geometry.

**`tensor` is the general escape, and it is load-bearing.** It keeps the component
general-purpose: a model whose task the contract does not model returns raw outputs, and the
component dispatches on the discriminator while knowing nothing about any particular task.
The _vocabularies_ are task-specific; the component is not. This is the same shape OIP takes
(tensors in, tensors out) and the reason OIP is a tensor envelope — that is the only shape
that generalizes across modalities.

### The engine keeps the generated union out of its domain

Go grew an `engine.InferenceResult` domain type (`Task` + untyped `Payload`), mapped from the
generated union **inside the adapter** (`build/ml.go`), never leaking `mlapi` into
the engine — the same api→domain discipline as camera's `mapping.go`. `toDomainResult`
rejects an unrecognised task rather than passing it through: an unknown task means the
component is newer than the engine, and a caller keying off the task would silently mis-read
the payload. The node emits the whole task-shaped payload (`task` field included), so a
downstream expression can branch on it without a second lookup.

Python handlers now declare a `task` class attribute and return the typed model; `yolo`
returns `DetectionResult`, `raw` returns `TensorResult`. `/metadata` reads the attribute off
the handler.

### What was scoped out and why

**No deploy-time task check.** It was floated, then dropped: `buildDeployML` makes no network
call, and a model's task exists only at runtime in the component's `/metadata`. Verifying a
node's expectations against the model needs a seam that does not exist yet — a static task
declaration on the binding, or a probe. Worth doing; needs the seam first.

---

## Phase C — declarative preprocessing (deferred)

The live problem: adding a vision model means hand-writing a Python `handler.py` unless it is
a YOLOv8 export. The tempting fix is a declarative `preprocess:` block in the manifest —
resize mode, mean/std, colorspace, layout — interpreted at load. It is deferred, and the
deferral is a decision, not a backlog entry.

### What the shape would be

A closed-vocabulary block, **discriminated by modality** — because preprocessing does not
unify across modalities and pretending it does is how a config becomes a bad language.
Hugging Face is the empirical proof: `preprocessor_config.json` for a vision model
(`image_mean`, `size`) and for an audio model (`sampling_rate`, `n_fft`) share **not one
field**. Text does not have the file at all — tokenization is a shipped artifact, not
config. So: `kind: image` (declarable), `kind: audio` (declarable, later), `kind: tensor`
(the caller prepared tensors — today's `raw` path), `kind: custom` (`file:pre.py`, the escape
hatch). Field names borrowed from HF so an export maps mechanically.

Crucially: **preprocessing is a model fact, never workflow config.** Its parameters are fixed
by the model's training, unverifiable by a workflow author, and wrong values degrade accuracy
_silently_ — no error, just worse results. They belong versioned with the weights. Author
intent (crop, rotate, resize-for-transmission) is separate upstream nodes; the semantic knobs
a node exposes (`topK`, `confThreshold`) ride the existing manifest → config → request
precedence chain. Post-processing stays code — NMS and anchor decoding are algorithms, not
config.

### Aufwand and when it is worth it

Two options, and the cheaper one is the recommendation until a specific condition flips.

**Option A — a preprocessing library (~1 day).** Extract `letterbox` / `normalize` /
`to_nchw` and a typed `ImageContext` out of `yolo.py` into `app/preprocess/`; a bundle's
`handler.py` becomes ~5 lines composing them. No contract change, no DSL. It captures the
real correctness win — the one tested letterbox and its coordinate round-trip, which is the
part everyone gets subtly wrong — with nothing to maintain. **Worth doing whenever this code
is next touched.** It is also the foundation the DSL would compile onto.

**Option B — the declarative DSL (~1–2 weeks).** Vocabulary design, load-time interpreter,
per-stage escape hatch, EXIF/channel decode-policy fields, numeric fixtures against reference
preprocessing, docs. **Worth it only if one of these becomes true:**

1. **`fh-backend` accepts bundles from someone not fully trusted** (a marketplace, hosted,
   multi-tenant). Validated data is not executable code; `file:handler.py` is arbitrary
   Python at container privilege. This is the strongest argument and it connects directly to
   the closed product — it is HF's own model (`trust_remote_code=True` gates exactly this).
2. **A Go port of the component is real.** Configs port across languages; scripts do not. A
   Go rewrite would shed the Python dependency but not the native one (ONNX Runtime is CGO
   either way), and would lose `file:pre.py` — so the declarative path is what makes a port
   survivable.

If both are "no", **do not build it.** A DSL with one consumer is a language you maintain for
yourself; Option A gets most of the value at a twentieth of the cost.

### The resize-fidelity trap, whichever path

Pin interpolation semantics explicitly — library and mode, not "bilinear" — and keep numeric
fixtures. This is the one place preprocessing produces a subtly-wrong tensor with no error.
HF ships an entire second backend (PIL alongside Torchvision) for exactly this parity
concern, and _still_ has silent bicubic fallbacks. The risk is real and language-independent.

---

## On OIP and cloud providers

Recorded because it will come up again. **There is no general-purpose cloud ML inference API**
in the LLM-proxy sense — hosted inference is either opaque byte pipes (SageMaker, Vertex) or
per-model schemas (Replicate), and only _task-level_ APIs (HF's `image-classification` etc.)
normalize, shallowly and client-side. So **do not build an mlproxy** mirroring llmproxy: that
abstraction pays off for implicit dispatch across interchangeable providers, and ML inference
has one implementation selected explicitly at build time. The `engine.MLClient` port
is already the seam a second runtime would implement.

**Take OIP's data model, not its protocol.** KServe's Open Inference Protocol is the real
tensor standard (Triton, MLServer, TorchServe implement it), but as a wire it only serves the
`tensor` path — the path where the component adds least, since a Triton drop-in gives
`session.run` without the preprocessing or decoders that are the whole value. Adopting it as
_the_ wire means two endpoints and two clients for a benefit nobody is asking for. What is
worth borrowing now is its **tensor representation** — explicit `datatype` + `shape` on the
`tensors` field, replacing today's shapeless nested arrays — which strengthens the `raw` path
and makes a future `/v2/.../infer` adapter a transcription rather than a redesign.

---

## Still open

1. **Deploy-time task validation** — an `ObjectDetection` node bound to a classifier is
   caught at first inference, not at deploy. Needs a static task declaration on the binding or
   a `/metadata` probe; the wire now carries the task, so the data exists.
2. **The preprocessing DSL** — deferred behind the untrusted-bundles / Go-port questions
   above. Option A (the library) is unblocked and cheap; do it first regardless.
3. **OIP tensor representation** — adopt `datatype`+`shape` on the tensor field before the
   `raw` path grows more users; low cost, forward-compatible.
4. **`file:handler.py` is a privilege boundary** — arbitrary operator-trusted Python loaded
   from the workspace, so the workspace mount carries executable code, not just data. Fine
   while the operator authors bundles; needs a trust gate the day bundles come from elsewhere.
   Same forcing function as the DSL (item 2.1).
