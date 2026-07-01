"""FastAPI service: load the model repository at startup and serve inference.

The whole models repository is loaded once during startup (fail-fast — an empty
or broken repository aborts the process). Each request to `/infer` selects one
loaded model by name and drives its handler: preprocess -> infer ->
postprocess. Responses use the contract-generated Pydantic models, so the wire
shape stays locked to `contract/mlinference.yaml`.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .api.models import Health, InferResult, ModelMetadata, RepositoryMetadata
from .config import load_config
from .repository import LoadedModel, load_repository


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load every model bundle before the server accepts traffic."""
    config = load_config()
    app.state.models = load_repository(config.models_dir)
    yield


app = FastAPI(title="fh-onnx", lifespan=lifespan)


def _models(app: FastAPI) -> dict[str, LoadedModel]:
    return app.state.models


@app.get("/healthz", response_model=Health)
def healthz() -> Health:
    """Liveness: the process is up. Always 200."""
    return Health(status="ok")


@app.get("/readyz", response_model=Health)
def readyz() -> Health:
    """Readiness: 200 once at least one model is loaded, else 503."""
    if not _models(app):
        raise HTTPException(status_code=503, detail="repository not loaded")
    return Health(status="ok")


@app.get("/metadata", response_model=RepositoryMetadata)
def metadata() -> RepositoryMetadata:
    """List every loaded model and how it is driven."""
    return RepositoryMetadata(
        models=[
            ModelMetadata(
                name=lm.name,
                handler=lm.manifest.handler,
                modelVersion=lm.manifest.params.get("version"),
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
        raise HTTPException(status_code=400, detail=f"{name} is not valid JSON: {e}") from e
    if not isinstance(value, dict):
        raise HTTPException(status_code=400, detail=f"{name} must be a JSON object")
    return value


@app.post("/infer", response_model=InferResult)
async def infer(
    model: str = Form(...),
    binary: UploadFile | None = File(None),
    tensors: str | None = Form(None),
    params: str | None = Form(None),
) -> InferResult:
    """Run one loaded model: select by name, preprocess, infer, postprocess."""
    lm = _models(app).get(model)
    if lm is None:
        raise HTTPException(status_code=404, detail=f"unknown model '{model}'")

    binary_data = await binary.read() if binary is not None else None
    tensor_data = _parse_object("tensors", tensors)
    # request params override the bundle's manifest params
    effective_params = {**lm.manifest.params, **_parse_object("params", params)}

    try:
        feed, context = lm.handler.preprocess(binary_data, tensor_data, effective_params)
        outputs = lm.handler.infer(lm.session, feed, context, effective_params)
        result = lm.handler.postprocess(outputs, context, effective_params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return InferResult(model=model, result=result)
