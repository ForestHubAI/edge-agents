# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""FastAPI service: load the model repository at startup and serve inference.

The whole models repository is loaded once during startup (fail-fast — an empty
or broken repository aborts the process). Inference is addressed per model in the
path (`/models/{model}/infer/...`) and splits by input kind: `binary` feeds a raw
encoded artifact the handler decodes, `tensors` feeds already-numeric typed
tensors. Each request drives the selected model's handler: preprocess -> infer ->
postprocess. Responses use the contract-generated Pydantic models, so the wire
shape stays locked to `contract/ml.yaml`.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.models import (
    Error,
    Health,
    InferResult,
    ModelMetadata,
    RepositoryMetadata,
    Tensor,
    TensorInput,
)
from .config import EXIT_BAD_CONFIG, WORKSPACE_DIR, ConfigError, load_boot_config
from .middleware import MaxBodySizeMiddleware
from .repository import LoadedModel, RepositoryError, load_repository

# Logs ride uvicorn's configured handler so they surface in the container logs.
logger = logging.getLogger("uvicorn.error")

# Generous cap for one encoded frame. It bounds an upload at the ASGI edge (by
# Content-Length, before the body is buffered) and again when the blob is read.
MAX_UPLOAD_BYTES = 32 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load every issued model bundle before the server accepts traffic."""
    try:
        # The boot config is authoritative: it names the bundles this component was
        # issued, and the repository loads exactly those from the mounted workspace.
        config = load_boot_config()
        app.state.models = load_repository(WORKSPACE_DIR, config.models)
    except (ConfigError, RepositoryError) as exc:
        # A bad config or an unloadable declared bundle fails identically on restart —
        # a permanent config error. Exit 78 (EX_CONFIG) so the orchestrator stops
        # retrying, matching the engine/camera components. os._exit bypasses uvicorn's
        # own exit handling, which would otherwise mask the code. Logged first
        # (StreamHandler flushes on emit).
        logger.error("boot failed, exiting: %s", exc)
        os._exit(EXIT_BAD_CONFIG)
    logger.info("loaded %d model(s) from %s", len(app.state.models), WORKSPACE_DIR)
    yield


app = FastAPI(title="fh-onnx", lifespan=lifespan)
app.add_middleware(MaxBodySizeMiddleware, max_bytes=MAX_UPLOAD_BYTES)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    """Render every error as the contract's Error schema ({"message": ...}), not
    FastAPI's default {"detail": ...}, so clients read one consistent shape."""
    return JSONResponse(status_code=exc.status_code, content=Error(message=str(exc.detail)).model_dump())


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    """A malformed request (e.g. a missing 'model' field) is unprocessable input:
    422, in the Error schema."""
    return JSONResponse(status_code=422, content=Error(message=str(exc)).model_dump())


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Last resort: any error not mapped above still leaves as the Error schema at
    500, never Starlette's default plaintext body."""
    logger.exception("unhandled error")
    return JSONResponse(status_code=500, content=Error(message="internal error").model_dump())


def _models(app: FastAPI) -> dict[str, LoadedModel]:
    return app.state.models


@app.get("/healthz", response_model=Health)
async def healthz() -> Health:
    """Liveness: the process is up. Always 200. Async so it stays on the event
    loop and can never be starved by the inference threadpool."""
    return Health(status="ok")


@app.get("/readyz", response_model=Health)
async def readyz() -> Health:
    """Readiness: 200 once at least one model is loaded, else 503. Async for the
    same reason as healthz — liveness/readiness must not queue behind inference."""
    if not _models(app):
        raise HTTPException(status_code=503, detail="repository not loaded")
    return Health(status="ok")


@app.get("/models", response_model=RepositoryMetadata)
async def list_models() -> RepositoryMetadata:
    """List every loaded model and how it is driven."""
    return RepositoryMetadata(models=[_model_metadata(lm) for lm in _models(app).values()])


@app.get("/models/{model}", response_model=ModelMetadata)
async def model_metadata(model: str) -> ModelMetadata:
    """Describe one loaded model — its handler, task, and optional version."""
    lm = _models(app).get(model)
    if lm is None:
        raise HTTPException(status_code=404, detail=f"unknown model '{model}'")
    return _model_metadata(lm)


def _model_metadata(lm: LoadedModel) -> ModelMetadata:
    """Build the metadata for one loaded model."""
    return ModelMetadata(
        name=lm.name,
        handler=lm.manifest.handler,
        task=lm.handler.task,
        modelVersion=_model_version(lm),
    )


def _model_version(lm: LoadedModel) -> str | None:
    """The bundle's optional version param, coerced to a string (YAML may type a
    bare number, which the metadata field rejects)."""
    version = lm.manifest.params.get("version")
    return None if version is None else str(version)


@app.post("/models/{model}/infer/binary", response_model=InferResult)
def infer_binary(
    model: str,
    body: bytes = Body(..., media_type="application/octet-stream"),
) -> InferResult:
    """Run one model on an opaque encoded input (e.g. an image) carried as the raw
    request body. Sync (not async) so Starlette runs the blocking inference in a
    threadpool; FastAPI still reads the body asynchronously before invoking this."""
    # Backstop for a request without a Content-Length (the ASGI middleware holds
    # the real cap for requests that declare one).
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"upload exceeds {MAX_UPLOAD_BYTES} bytes")
    return _run(model, binary=body, tensors=None)


@app.post("/models/{model}/infer/tensors", response_model=InferResult)
def infer_tensors(model: str, tensors: TensorInput) -> InferResult:
    """Run one model on already-numeric named tensors carried as a JSON body. Sync
    for the same reason as infer_binary."""
    return _run(model, binary=None, tensors=tensors.root)


def _run(
    model: str,
    *,
    binary: bytes | None,
    tensors: dict[str, Tensor] | None,
) -> InferResult:
    """Select the model by name and drive its handler: preprocess, infer,
    postprocess. Shared by both inference endpoints."""
    lm = _models(app).get(model)
    if lm is None:
        raise HTTPException(status_code=404, detail=f"unknown model '{model}'")

    params = lm.manifest.params
    try:
        feed, context = lm.handler.preprocess(binary, tensors, params)
        outputs = lm.handler.infer(lm.session, feed, context, params)
        result = lm.handler.postprocess(outputs, context, params)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        # Log the full traceback for diagnosis; return a generic message so
        # internal detail (model internals, paths) does not leak to the client.
        logger.exception("inference failed for model '%s'", model)
        raise HTTPException(status_code=500, detail="inference failed") from e

    # The handler returns the task-shaped union variant directly; InferResult
    # (a RootModel over the union) validates and serializes it as the response.
    return result
