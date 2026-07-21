# Architecture & pipelines

How the component is layered and how a request flows through it. To add a handler see
[handlers.md](./handlers.md); to add a model bundle see [bundles.md](./bundles.md).

The design goal: **one generic image** that can serve any ONNX model, with all
model-specific knowledge pushed into mounted bundles and pluggable handlers. The
service code never mentions YOLO, NMS, or images.

## Three layers

```
        contract/ml.yaml          OpenAPI 3.0.3 — the wire (source of truth)
                 │  datamodel-codegen
                 ▼
        app/api/models.py                  GENERATED Pydantic models (Tensor, TensorInput,
                 │                          InferResult, RepositoryMetadata, …)
                 ▼
        app/  (the service)                config, manifest, handlers, repository, middleware, main
```

- **Contract** defines the endpoints and the request/response shapes. It is the
  single source of truth; the engine's Go client generates from the same file.
- **Generated models** are the Pydantic classes `main.py` uses for responses, so the
  wire stays locked to the contract. Never hand-edit — regenerate (`datamodel-codegen`).
- **Service** is the hand-written code below.

## The model repository

The container is a **model repository** (the Triton / TorchServe pattern): a mounted
directory holds one sub-folder per model; at startup the bundles the boot config
declares are loaded into a `name → LoadedModel` registry held on `app.state`. A request
selects one by name. One ONNX Runtime instance is shared across all of a deployment's
models.

```
/var/lib/foresthub/workspace/   (mounted, read-only)
├── yolo/            → LoadedModel(name="yolo",  session, handler, manifest)
└── my-classifier/   → LoadedModel(name="my-classifier", session, handler, manifest)
```

A `LoadedModel` (`repository.py`) bundles everything needed to run one model: its
ONNX `InferenceSession`, the resolved `Handler` instance, and the parsed `Manifest`.

## Startup pipeline (fail-fast)

`main.py` loads every issued bundle before the server accepts traffic, via FastAPI's
`lifespan`. Any failure — a missing or invalid `config.json`, a config declaring no
models, or a declared bundle that will not load — aborts the process with exit 78, so a
misconfigured deployment never serves stale or partial results.

```
uvicorn app.main:app
  → main.lifespan
      → load_boot_config()                    # config.py — /etc/foresthub/config.json
      → load_repository(workspace, declared)  # repository.py
          for each DECLARED <model-id>/ bundle:
            load_manifest(bundle)             # manifest.py — parse + validate manifest.yaml
            check the model file exists
            ort.InferenceSession(model.onnx)  # CPUExecutionProvider
            resolve_handler(manifest, bundle) # registry.py — builtin:<name> | file:<py>
            handler.load(session, manifest, bundle)   # one-time per-model setup
            → store LoadedModel in the registry
          empty repository → RepositoryError (abort)
  → app.state.models = registry               # ready to serve
```

`/healthz` returns 200 once the process is up; `/readyz` returns 200 only once the
registry is non-empty, else 503. `/models` lists the loaded models; `/models/{model}`
describes one (404 if absent).

## The infer pipeline

Inference is addressed per model in the path and split by input kind — one endpoint
per way the input arrives:

- `POST /models/{model}/infer/binary` — the raw request body (`application/octet-stream`)
  is an opaque encoded artifact (e.g. a JPEG) the handler decodes itself.
- `POST /models/{model}/infer/tensors` — a JSON body of already-numeric named `Tensor`s
  (KServe/OIP: `datatype` + `shape` + flat `data`) the caller prepared.

Both routes converge on `main._run`:

```
model (path) + (binary body | tensors body)
  → lm = app.state.models.get(model)              # registry lookup
        not found → HTTPException 404
  → params = lm.manifest.params                    # bundle defaults (+ deploy overrides)
  → feed, context = lm.handler.preprocess(binary, tensors, params)
  → outputs        = lm.handler.infer(lm.session, feed, context, params)  # run the model
  → result         = lm.handler.postprocess(outputs, context, params)
  → return result                                  # the task-shaped union variant, as-is
```

- **No request params.** The knobs a model needs live in its manifest (with any
  deployment overrides already merged at boot); there is no per-request override on the
  wire. Retuning is a redeploy, not a request field.
- **`feed` vs `context`.** `feed` is the dict ONNX Runtime consumes
  (`{input_name: ndarray}`). `context` is handler-private state remembered from
  preprocessing (for YOLO: the letterbox scale + padding) that `postprocess` needs to
  map results back — e.g. boxes from the model's input space to original-image pixels.
- **`infer` is the run step.** The default runs one forward pass — the common case.
  A handler that needs more (a separate encoder and decoder graph, or an
  autoregressive model that calls the session repeatedly) overrides `infer` and owns
  the loop; `main` stays the same. Extra graphs are opened by the handler in `load`.
- **Errors.** A handler raises `ValueError` for bad input (undecodable image, wrong-kind
  input, a tensor that does not match its shape); `main` maps that to HTTP 422. An
  unknown model is 404; an oversized binary body is 413.

The result is the task-shaped union variant, returned directly (no envelope) and
discriminated by `task`: the YOLO handler returns
`{ "task": "object-detection", "detections": [ { label, score, box: { xmin, ymin, xmax, ymax } } ] }`;
the raw handler returns `{ "task": "tensor", "tensors": { <name>: Tensor } }`.

## Why main.py is model-agnostic

`main._run` only does: **lookup → preprocess → infer → postprocess → return**. It knows
nothing about images, NMS, or tensor layouts — that all lives behind the `Handler`
interface. Swap the selected model's handler from `yolo` to `raw` and the exact same
`main.py` serves a decision-tree model. This is the seam that keeps one image generic
across every model family. See [handlers.md](./handlers.md).

## File map

| Concern | File |
| --- | --- |
| Endpoints, startup load, request orchestration | `app/main.py` |
| Contract paths + boot-config loader | `app/config.py` |
| Bundle manifest schema + loader | `app/manifest.py` |
| Repository scan → `name→LoadedModel` registry | `app/repository.py` |
| Handler interface | `app/handlers/base.py` |
| Handler resolution (`builtin:` / `file:`) + registry | `app/handlers/registry.py` |
| Built-in handlers | `app/handlers/yolo.py`, `app/handlers/raw.py` |
| Generated wire models (never hand-edit) | `app/api/models.py` |
| Wire contract (source of truth) | `contract/ml.yaml` |
