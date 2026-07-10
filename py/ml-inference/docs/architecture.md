# Architecture & pipelines

How the component is layered and how a request flows through it. To add a handler see
[handlers.md](./handlers.md); to add a model bundle see [bundles.md](./bundles.md).

The design goal: **one generic image** that can serve any ONNX model, with all
model-specific knowledge pushed into mounted bundles and pluggable handlers. The
service code never mentions YOLO, NMS, or images.

## Three layers

```
        contract/mlinference.yaml          OpenAPI 3.0.3 — the wire (source of truth)
                 │  datamodel-codegen
                 ▼
        app/api/models.py                  GENERATED Pydantic models (InferRequest,
                 │                          InferResult, RepositoryMetadata, …)
                 ▼
        app/  (the service)                config, manifest, handlers, repository, middleware, main
```

- **Contract** defines the four endpoints and the request/response shapes. It is the
  single source of truth; the engine's Go client generates from the same file.
- **Generated models** are the Pydantic classes `main.py` uses for responses, so the
  wire stays locked to the contract. Never hand-edit — regenerate (`datamodel-codegen`).
- **Service** is the hand-written code below.

## The model repository

The container is a **model repository** (the Triton / TorchServe pattern): a mounted
directory holds one sub-folder per model; at startup every bundle is loaded into a
`name → LoadedModel` registry held on `app.state`. A request selects one by name.
One ONNX Runtime instance is shared across all of a deployment's models.

```
/var/lib/foresthub/models/   (mounted, read-only)
├── yolo/            → LoadedModel(name="yolo",  session, handler, manifest)
└── my-classifier/   → LoadedModel(name="my-classifier", session, handler, manifest)
```

A `LoadedModel` (`repository.py`) bundles everything needed to run one model: its
ONNX `InferenceSession`, the resolved `Handler` instance, and the parsed `Manifest`.

## Startup pipeline (fail-fast)

`main.py` loads the whole repository before the server accepts traffic, via FastAPI's
`lifespan`. Any failure — or an empty repository — aborts the process, so a
misconfigured deployment never serves stale or partial results.

```
uvicorn app.main:app
  → main.lifespan
      → load_config()                         # ML_MODELS_DIR
      → load_repository(models_dir)           # repository.py
          for each <model-id>/ sub-folder:
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
registry is non-empty, else 503.

## The /infer pipeline

`POST /infer` is `multipart/form-data`: a required `model` selector, an optional
`binary` part (e.g. an image), an optional `tensors` field (named numeric arrays as
JSON), and optional `params` (JSON overrides). The flow in `main.infer`:

```
multipart: model + (binary and/or tensors) + params
  → lm = app.state.models.get(model)              # registry lookup
        not found → HTTPException 404
  → effective_params = { **manifest.params, **request_params }   # request wins
  → feed, context = lm.handler.preprocess(binary, tensors, effective_params)
  → outputs        = lm.handler.infer(lm.session, feed, context, effective_params)  # run the model
  → result         = lm.handler.postprocess(outputs, context, effective_params)
  → InferResult(model=model, result=result)        # contract-shaped JSON
```

- **Params merge.** The manifest carries defaults; the request may override per call
  (e.g. a stricter `confThreshold`) without a redeploy. Conflicts resolve in the
  request's favor.
- **`feed` vs `context`.** `feed` is the dict ONNX Runtime consumes
  (`{input_name: ndarray}`). `context` is handler-private state remembered from
  preprocessing (for YOLO: the letterbox scale + padding) that `postprocess` needs to
  map results back — e.g. boxes from the model's input space to original-image pixels.
- **`infer` is the run step.** The default runs one forward pass — the common case.
  A handler that needs more (a separate encoder and decoder graph, or an
  autoregressive model that calls the session repeatedly) overrides `infer` and owns
  the loop; `main` stays the same. Extra graphs are opened by the handler in `load`.
- **Errors.** A handler raises `ValueError` for bad input (undecodable image, missing
  tensors); `main` maps that to HTTP 422. An unknown model is 404.

The result shape is defined by the handler, not the contract: the YOLO handler
returns `{ "detections": [ { label, score, box: { x, y, w, h } } ] }`; the raw
handler returns `{ "outputs": { <name>: <nested array> } }`.

## Why main.py is model-agnostic

`main.infer` only does: **lookup → preprocess → infer → postprocess → wrap**. It knows
nothing about images, NMS, or tensor layouts — that all lives behind the `Handler`
interface. Swap the selected model's handler from `yolo` to `raw` and the exact same
`main.py` serves a decision-tree model. This is the seam that keeps one image generic
across every model family. See [handlers.md](./handlers.md).

## File map

| Concern | File |
| --- | --- |
| Endpoints, startup load, request orchestration | `app/main.py` |
| Where bundles are mounted (`ML_MODELS_DIR`) | `app/config.py` |
| Bundle manifest schema + loader | `app/manifest.py` |
| Repository scan → `name→LoadedModel` registry | `app/repository.py` |
| Handler interface | `app/handlers/base.py` |
| Handler resolution (`builtin:` / `file:`) + registry | `app/handlers/registry.py` |
| Built-in handlers | `app/handlers/yolo.py`, `app/handlers/raw.py` |
| Generated wire models (never hand-edit) | `app/api/models.py` |
| Wire contract (source of truth) | `contract/mlinference.yaml` |
