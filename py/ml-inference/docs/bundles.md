# Model bundles & the repository

A **model bundle** is a folder holding one model plus the metadata that tells the
sidecar how to load and drive it. The mounted **repository** is a directory of such
bundles. This doc covers the bundle format and how to add a model; for the handler a
bundle selects, see [handlers.md](./handlers.md).

## The repository

The sidecar scans a mounted directory at startup and loads **every** sub-folder as a
bundle (`repository.py`). The folder name is the model **id** — the value a request
passes as `/infer`'s `model`. The mount is read-only; default `ML_MODELS_DIR` is
`/var/lib/foresthub/models`.

```
models/                 # mounted read-only into the container
├── yolo/               # model id = "yolo"
│   ├── manifest.yaml
│   ├── model.onnx      # weights — NOT committed to git
│   └── coco.txt
└── my-classifier/      # add a model = add a sibling folder
    ├── manifest.yaml
    └── model.onnx
```

Loading is **fail-fast**: an empty repository or any one broken bundle aborts startup
(see [architecture.md](./architecture.md)). Adding a model is purely additive — drop
in another folder; nothing else changes.

## The manifest (`manifest.yaml`)

Each bundle carries a `manifest.yaml`, parsed and validated by `manifest.py`. Only
**universal** fields are typed; everything model-specific lives in the free-form
`params`, so the schema stays model-type-agnostic.

```yaml
schemaVersion: 1
handler: builtin:yolo       # builtin:<name>  or  file:<relative.py>
model: model.onnx           # the ONNX file, relative to the bundle
params:                     # free-form; interpreted by the handler
  input: { width: 640, height: 640 }
  labels: coco.txt
  confThreshold: 0.25
  nmsThreshold: 0.45
```

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Manifest **format** version this build understands (see below). |
| `handler` | Which handler drives the model — `builtin:<name>` or `file:<py>`. |
| `model` | The ONNX file path inside the bundle. |
| `params` | Free-form bag of handler-specific settings (input size, labels, thresholds, …). Merged under per-request `params` at inference time. |

An invalid manifest (missing file, bad YAML, unknown `schemaVersion`, missing required
field) raises `ManifestError` and aborts startup — never a silent default.

## Why `schemaVersion`

`schemaVersion` versions the **manifest format itself** (currently `1`,
`SCHEMA_VERSION` in `manifest.py`). The bundle and the sidecar image are shipped
separately and can drift — an old bundle on a new image, or vice versa. If the format
later changes (a field renamed, or its meaning changed), an image reading a
mismatched manifest could silently misinterpret it.

`schemaVersion` makes that mismatch **loud**: the image declares the version it
understands and rejects any other at startup, with a clear error, instead of
misbehaving at inference time. It pins *model weights ↔ manifest format ↔ handler
code* so they cannot silently diverge — the same idea as a file-format version.

Bump it only on a **breaking** format change (rename/remove a typed field, change a
field's meaning). Adding an optional `params` key needs no bump — `params` is
free-form.

## Checklist — add a model bundle

1. **Pick a handler.** A built-in (`builtin:yolo`, `builtin:raw`) for a standard task,
   or a `file:handler.py` for a custom one (see [handlers.md](./handlers.md)).
2. **Create the folder** under the repository; the folder name is the model id.
3. **Place the ONNX file** (e.g. `model.onnx`) and any handler assets (a labels file,
   …). Weights are **not** committed to git — they are mounted/placed at deploy time.
4. **Write `manifest.yaml`** — `schemaVersion: 1`, `handler`, `model`, and the
   `params` the chosen handler reads.
5. **Verify it loads.** Mount the repository and check `GET /metadata` lists the model,
   then `POST /infer` with `model: <id>`. `scripts/smoke.sh` does this end-to-end for
   the example.

## Exporting an ONNX model

Any framework that exports ONNX works — PyTorch (`torch.onnx.export`), Hugging Face
(`optimum-cli export onnx`), scikit-learn (`skl2onnx`), TensorFlow (`tf2onnx`). Two
general rules:

- **Opset:** use an opset the runtime supports (onnxruntime is pinned in
  `requirements.txt`). Newer is not better — pick a widely-supported opset.
- **Input/output layout** must match what the handler expects. For `builtin:raw`, only
  the input names/dtypes matter (tensors in, tensors out). For a vision handler, the
  input is NCHW float and the output layout is handler-specific.

### YOLO specifically (`builtin:yolo`)

Export from the official checkpoint and **do not bake in NMS** — the handler runs NMS
itself so thresholds stay tunable per request, and it expects the raw detection output
`(1, 4+classes, anchors)`:

```bash
pip install ultralytics
yolo export model=yolov8n.pt format=onnx imgsz=640    # nms defaults to False — keep it
```

`imgsz=640` matches the example manifest's `params.input`. The handler also reads
`labels` (a class-name file like `coco.txt`, one name per line) and the optional
`confThreshold` / `nmsThreshold` from `params`.

## Mounting

```yaml
services:
  fh-onnx:
    image: fh-onnx:latest
    pull_policy: never                 # built locally; never published
    volumes:
      - ./models:/var/lib/foresthub/models:ro
```

The image ships no models — the repository is always mounted. See
`py/ml-inference/README.md` for the full run instructions.
