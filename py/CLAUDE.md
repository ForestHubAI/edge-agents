# py/ — ONNX inference component

Python service `fh-onnx` (`py/ml-inference/`): a generic ONNX inference **model
repository** served over HTTP (FastAPI + onnxruntime). The repo-wide rule about the
`contract/` being the source of truth applies here — see the root `CLAUDE.md`.
User-facing build/run/API docs live in `py/ml-inference/README.md`; this file and
`py/ml-inference/docs/` are the contributor map.

## Layout

```
app/
  main.py        FastAPI app: loads the repository at startup, serves the endpoints.
  middleware.py  ASGI middleware (request-body size cap, enforced before buffering).
  config.py      contract paths + boot-config loader (config.json → MLInferenceConfig).
  manifest.py    bundle manifest schema (Manifest) + loader (fail-fast validation).
  repository.py  loads the issued bundles at startup → name→LoadedModel registry.
  api/models.py  GENERATED Pydantic models from ../../contract/mlinference.yaml.
                 Never hand-edit; regenerate instead.
  handlers/
    base.py      Handler interface (load / preprocess / postprocess).
    registry.py  resolves manifest.handler → a Handler (builtin:<name> | file:<py>).
    yolo.py      built-in object-detection handler.
    raw.py       built-in tensor passthrough handler.
examples/        example model repository (a yolo bundle; weights not committed).
tests/           pytest, weights-free (synthetic tensors/images).
scripts/smoke.sh end-to-end test (build image, serve example, POST /infer).
```

## Architecture

The container is a **model repository**: at startup it loads the `<model-id>/` bundles
its boot config issues it, from the mounted workspace, into a `name → LoadedModel`
registry; a request selects one by name. One container hosts many models behind one
ONNX Runtime — not one container per model.

The boot config (`config.json` → `MLInferenceConfig`) is **authoritative**: exactly the
bundles it declares are loaded. A declared bundle that is missing or broken aborts
startup; an undeclared sub-folder in the workspace is ignored, never loaded implicitly.

Two pipelines (full write-ups in [docs/architecture.md](ml-inference/docs/architecture.md)):

- **Startup (fail-fast):** `main.lifespan` → `load_boot_config` → `load_repository` →
  per declared bundle: `load_manifest` → open ONNX session → `resolve_handler` →
  `handler.load`. A bad config or any unloadable declared bundle aborts startup, so a
  misconfigured deployment never serves.
- **`/infer`:** look up the model (404 if unknown) → merge manifest+request params →
  `handler.preprocess` → `session.run` → `handler.postprocess` → `InferResult`.

`main.py` is model-agnostic; all model-specific logic lives in a handler. See
[docs/handlers.md](ml-inference/docs/handlers.md) to add one,
[docs/bundles.md](ml-inference/docs/bundles.md) to add a model.

## Conventions

- **Contract is source of truth.** `app/api/models.py` is generated from
  `contract/mlinference.yaml`; never hand-edit. Regenerate with
  `cd py/ml-inference && datamodel-codegen` (config in `pyproject.toml`,
  `[tool.datamodel-codegen]`). Output is black/isort-formatted and timestamp-free so
  the CI drift guard diffs cleanly.
- **Docstrings:** module docstring everywhere; docstrings on the public surface and
  non-obvious logic; trivial private helpers rely on a clear name. No internal jargon
  or planning references — the code reads as standalone OSS.
- **Errors:** handlers raise `ValueError` for bad request input (mapped to HTTP 422);
  load-time problems raise `ManifestError` / `HandlerError` / `RepositoryError` and
  abort startup.
- **Tests:** pytest, `tests/test_<module>.py`, one file per handler. Weights-free —
  synthetic tensors/images, no ONNX model, no Docker, so they run in CI.

## Build / test / generate

Run from inside `py/ml-inference/`:

```
pip install -r requirements.txt        # runtime stack
pip install -e ".[dev]"                # ruff, pytest, datamodel-code-generator
datamodel-codegen                       # regen app/api/models.py from the contract
ruff check .                            # lint
python -m pytest -q                     # unit tests (no model/Docker needed)
docker build -t fh-onnx:dev .           # build the image
```

The image is built locally and never published (`pull_policy: never`).

## Gotchas

- **Run pytest from `py/ml-inference/`**, not the repo root — `pythonpath = ["."]` in
  `pyproject.toml` puts `app` on the import path only when pytest's rootdir is this
  directory.
- **Importing `app.handlers` registers the built-ins.** Its `__init__` imports `yolo`
  + `raw`, whose `@register_builtin` runs on import. A new built-in handler must be
  imported there or `builtin:<name>` won't resolve.
- **The image ships no models.** Bundles are mounted at runtime under the contracted
  workspace path (`/var/lib/foresthub/workspace`) — a constant, not configuration, so
  there is no env override. Model weights and the downloaded test image are
  git-ignored, never committed.
- **A `file:handler.py` runs as operator-trusted code** — arbitrary Python with the
  container's privileges. Built-ins need no such trust. See `docs/handlers.md`.
