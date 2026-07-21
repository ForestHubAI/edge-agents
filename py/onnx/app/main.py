# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""FastAPI service: load the model repository at startup and serve inference.

The whole models repository is loaded once during startup (fail-fast — an empty
or broken repository aborts the process). Each request to `/infer` selects one
loaded model by name and drives its handler: preprocess -> infer ->
postprocess. Responses use the contract-generated Pydantic models, so the wire
shape stays locked to `contract/mlinference.yaml`.
"""

from __future__ import annotations

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .api.models import Error, Health, InferResult, ModelMetadata, RepositoryMetadata
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


@app.get("/metadata", response_model=RepositoryMetadata)
async def metadata() -> RepositoryMetadata:
    """List every loaded model and how it is driven."""
    return RepositoryMetadata(
        models=[
            ModelMetadata(
                name=lm.name,
                handler=lm.manifest.handler,
                modelVersion=_model_version(lm),
            )
            for lm in _models(app).values()
        ]
    )


def _parse_object(name: str, raw: str | None) -> dict[str, Any]:
    """Decode an optional JSON object form field; empty -> {}."""
    if not raw:
        return {}
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=422, detail=f"{name} is not valid JSON: {e}") from e
    if not isinstance(value, dict):
        raise HTTPException(status_code=422, detail=f"{name} must be a JSON object")
    return value


def _model_version(lm: LoadedModel) -> str | None:
    """The bundle's optional version param, coerced to a string (YAML may type a
    bare number, which the metadata field rejects)."""
    version = lm.manifest.params.get("version")
    return None if version is None else str(version)


def _read_upload(binary: UploadFile | None) -> bytes | None:
    """Read the uploaded blob, bounded to MAX_UPLOAD_BYTES as a backstop for a
    request that arrives without a Content-Length (the middleware covers the rest)."""
    if binary is None:
        return None
    data = binary.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"upload exceeds {MAX_UPLOAD_BYTES} bytes")
    return data


@app.post("/infer", response_model=InferResult)
def infer(
    model: str = Form(...),
    binary: UploadFile | None = File(None),
    tensors: str | None = Form(None),
    params: str | None = Form(None),
) -> InferResult:
    """Run one loaded model: select by name, preprocess, infer, postprocess.

    A plain (non-async) endpoint so Starlette runs it in a threadpool — the
    inference is blocking CPU work, and keeping it off the event loop lets
    concurrent requests proceed.
    """
    lm = _models(app).get(model)
    if lm is None:
        raise HTTPException(status_code=404, detail=f"unknown model '{model}'")

    binary_data = _read_upload(binary)
    tensor_data = _parse_object("tensors", tensors)
    # request params override the bundle's manifest params
    effective_params = {**lm.manifest.params, **_parse_object("params", params)}

    try:
        feed, context = lm.handler.preprocess(binary_data, tensor_data, effective_params)
        outputs = lm.handler.infer(lm.session, feed, context, effective_params)
        result = lm.handler.postprocess(outputs, context, effective_params)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        # Log the full traceback for diagnosis; return a generic message so
        # internal detail (model internals, paths) does not leak to the client.
        logger.exception("inference failed for model '%s'", model)
        raise HTTPException(status_code=500, detail="inference failed") from e

    return InferResult(model=model, result=result)
