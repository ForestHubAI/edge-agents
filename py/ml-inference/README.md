# fh-onnx

A generic ONNX inference sidecar: one container that runs your ONNX models behind
a small HTTP API (FastAPI + [ONNX Runtime](https://onnxruntime.ai/)). Built once,
it serves any model family — vision, classical ML, time-series — because the model
weights and their pre/post-processing live in **mounted bundles**, not in the image.

## Model repository

The container is a **model repository**: at startup it scans a mounted directory of
bundles and loads *every* one into memory. A request picks which model to run by
name. One container thus hosts all of a deployment's models behind a shared runtime
— not one container per model.

```
models/                 # mounted at /var/lib/foresthub/models (read-only)
├── yolo/                # model id = folder name
│   ├── manifest.yaml
│   ├── model.onnx
│   └── coco.txt
└── my-classifier/       # add a model = add a folder
    ├── manifest.yaml
    └── model.onnx
```

Loading is **fail-fast**: an empty repository or any broken bundle aborts startup, so
a misconfigured deployment never serves stale or partial results.

### Bundle manifest

Each bundle has a `manifest.yaml`. Only universal fields are typed; everything
model-specific lives in the free-form `params`, interpreted by the handler:

```yaml
schemaVersion: 1
handler: builtin:yolo        # builtin:<name> or file:handler.py
model: model.onnx
params:
  input: { width: 640, height: 640 }
  labels: coco.txt
  confThreshold: 0.25
  nmsThreshold: 0.45
```

### Handlers

A handler turns raw input into a model feed and the model output into a structured
result. The `handler` field selects one:

- `builtin:yolo` — object detection for YOLO-family models (image in, detections out).
- `builtin:raw` — pass named tensors straight through (tensors in, tensors out). The
  zero-code fit for classical ML, time-series and embedding models.
- `file:handler.py` — a custom handler shipped in the bundle (runnable example:
  `examples/models/yolo-custom/`). **This is arbitrary Python executed with the
  container's privileges — it is loaded under an operator-trusted assumption** (same
  trust level as the mounted weights and the compose file). Do not mount handler files
  from untrusted sources.

## API

| Endpoint        | Purpose                                                        |
|-----------------|----------------------------------------------------------------|
| `GET /healthz`  | liveness — always `200`                                        |
| `GET /readyz`   | readiness — `200` once the repository is loaded, else `503`    |
| `GET /metadata` | list the loaded models (name, handler)                         |
| `POST /infer`   | run a model: `multipart/form-data` with `model` + `binary` and/or `tensors` (+ optional `params`) |

`POST /infer` returns `{ "model": "...", "result": { ... } }`. The `result` shape is
defined by the model's handler, not by this service — e.g. the YOLO handler
returns `{ "detections": [ { "label", "score", "box": { x, y, w, h } } ] }`.

## Build & run

The image is **built locally** — this repo publishes no images:

```bash
docker build -t fh-onnx:latest py/ml-inference
docker run --rm -p 8000:8000 \
  -v "$PWD/models:/var/lib/foresthub/models:ro" \
  fh-onnx:latest
```

In a compose deployment the engine reaches the sidecar over the Docker network;
because the image is self-built, pin `pull_policy: never`:

```yaml
services:
  fh-onnx:
    image: fh-onnx:latest
    pull_policy: never
    volumes:
      - ./models:/var/lib/foresthub/models:ro
```
