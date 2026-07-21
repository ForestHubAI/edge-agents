# fh-onnx

A generic ONNX inference component: one container that runs your ONNX models behind
a small HTTP API (FastAPI + [ONNX Runtime](https://onnxruntime.ai/)). Built once,
it serves any model family — vision, classical ML, time-series — because the model
weights and their pre/post-processing live in **mounted bundles**, not in the image.

## Model repository

The container is a **model repository**: bundles are staged in a mounted directory, and
at startup it loads the ones its boot config issues it. A request picks which model to
run by name. One container thus hosts all of a deployment's models behind a shared
runtime — not one container per model.

```
/var/lib/foresthub/workspace/   # the mounted repository root (read-only)
├── yolo/                # model id = folder name
│   ├── manifest.yaml
│   ├── model.onnx
│   └── coco.txt
└── my-classifier/       # stage a folder, then declare it in the boot config
    ├── manifest.yaml
    └── model.onnx
```

The boot config (`/etc/foresthub/config.json`, written by the deploy renderer) is
**authoritative**: exactly the bundles it declares are loaded. A sub-folder that is
present but undeclared is ignored, so staging a bundle is not by itself enough to serve
it.

Loading is **fail-fast**: a missing or invalid config, a config declaring no models, or
any declared bundle that will not load aborts startup with exit 78, so a misconfigured
deployment never serves stale or partial results.

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

| Endpoint                              | Purpose                                                        |
|---------------------------------------|----------------------------------------------------------------|
| `GET /healthz`                        | liveness — always `200`                                        |
| `GET /readyz`                         | readiness — `200` once the repository is loaded, else `503`    |
| `GET /models`                         | list the loaded models (name, handler, task, version)          |
| `GET /models/{model}`                 | describe one loaded model                                      |
| `POST /models/{model}/infer/binary`   | run a model on an opaque encoded input — the raw request body (`application/octet-stream`), e.g. a JPEG |
| `POST /models/{model}/infer/tensors`  | run a model on already-numeric named tensors — a JSON body of typed `Tensor`s |

Both `infer` endpoints return the **task-shaped result directly** (no envelope),
discriminated by `task`. The shape is defined by the model's task, not by the caller —
e.g. an object-detection model returns
`{ "task": "object-detection", "detections": [ { "label", "score", "box": { xmin, ymin, xmax, ymax } } ] }`.
A `tensors` request body and a `tensor`-task result both use the KServe/OIP `Tensor`
shape — `{ "datatype", "shape", "data" }` — keyed by the model's input/output names.

## Build & run

The image is **built locally** — this repo publishes no images:

```bash
docker build -t fh-onnx:latest py/onnx
docker run --rm -p 8000:8082 \
  -v "$PWD/models:/var/lib/foresthub/workspace:ro" \
  fh-onnx:latest
```

In a compose deployment the engine reaches the component over the Docker network;
because the image is self-built, pin `pull_policy: never`:

```yaml
services:
  onnx:
    image: fh-onnx:latest
    pull_policy: never
    volumes:
      - ./models:/var/lib/foresthub/workspace:ro
```
