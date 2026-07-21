# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Service-layer tests for the FastAPI app.

A stub model is placed directly on ``app.state.models`` so the endpoints run
without ONNX Runtime or a real bundle. These pin the wire contract the Go engine
depends on: the two path-addressed inference endpoints, the bare task-shaped result
(no envelope), the error-body shape (``{"message": ...}``, not FastAPI's default
``{"detail": ...}``) and the 404/413/422 status codes.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.models import Datatype, Task, Tensor, TensorResult
from app.handlers.base import Handler
from app.main import app
from app.manifest import Manifest
from app.repository import LoadedModel

# A canned typed output tensor the stub returns.
_STUB_TENSORS = {"y": Tensor(datatype=Datatype.INT64, shape=[1], data=[1])}
_STUB_RESULT_JSON = {"task": "tensor", "tensors": {"y": {"datatype": "INT64", "shape": [1], "data": [1]}}}


class _StubHandler(Handler):
    """Records what it was fed and returns a canned result; optionally raises."""

    task = Task.tensor

    def __init__(self, raise_message: str | None = None):
        self.raise_message = raise_message
        self.got_binary = None
        self.got_tensors = None

    def preprocess(self, binary, tensors, params):
        if self.raise_message is not None:
            raise ValueError(self.raise_message)
        self.got_binary = binary
        self.got_tensors = tensors
        return ({}, None)

    def infer(self, session, feed, context, params):
        return []

    def postprocess(self, outputs, context, params):
        return TensorResult(task="tensor", tensors=_STUB_TENSORS)


def _install_model(handler: Handler, name: str = "m") -> None:
    app.state.models = {
        name: LoadedModel(
            name=name,
            session=None,
            handler=handler,
            manifest=Manifest(
                schemaVersion=1,
                handler="builtin:stub",
                model="m.onnx",
                params={"version": "1.2"},
            ),
        )
    }


@pytest.fixture
def client() -> TestClient:
    # No ``with`` block: the lifespan (which would scan a real models dir) does
    # not run, so each test seeds app.state.models directly. Reset to empty so
    # tests do not leak state into one another.
    app.state.models = {}
    return TestClient(app)


def test_healthz_is_ok(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_readyz_ok_when_models_loaded(client):
    _install_model(_StubHandler())
    assert client.get("/readyz").status_code == 200


def test_readyz_503_when_no_models(client):
    # Readiness is distinct from liveness: an empty repository is not ready.
    assert client.get("/readyz").status_code == 503


def test_list_models(client):
    _install_model(_StubHandler())
    r = client.get("/models")
    assert r.status_code == 200
    model = r.json()["models"][0]
    assert model["name"] == "m"
    assert model["handler"] == "builtin:stub"
    assert model["task"] == "tensor"
    assert model["modelVersion"] == "1.2"


def test_model_metadata_one(client):
    _install_model(_StubHandler())
    r = client.get("/models/m")
    assert r.status_code == 200
    assert r.json()["name"] == "m"
    assert r.json()["task"] == "tensor"


def test_model_metadata_unknown_is_404_with_message(client):
    _install_model(_StubHandler())
    r = client.get("/models/ghost")
    assert r.status_code == 404
    assert r.json() == {"message": "unknown model 'ghost'"}


def test_infer_unknown_model_is_404_with_message(client):
    _install_model(_StubHandler())
    r = client.post("/models/ghost/infer/tensors", json={})
    assert r.status_code == 404
    # The contract's Error schema uses "message" — the Go client reads that key.
    assert r.json() == {"message": "unknown model 'ghost'"}


def test_infer_dispatches_tensors(client):
    handler = _StubHandler()
    _install_model(handler)
    body = {"x": {"datatype": "FP32", "shape": [2], "data": [1, 2]}}
    r = client.post("/models/m/infer/tensors", json=body)
    assert r.status_code == 200
    # No envelope: the bare task-shaped result comes back.
    assert r.json() == _STUB_RESULT_JSON
    assert set(handler.got_tensors) == {"x"}
    assert handler.got_tensors["x"].data == [1, 2]
    assert handler.got_binary is None


def test_infer_dispatches_binary(client):
    handler = _StubHandler()
    _install_model(handler)
    r = client.post(
        "/models/m/infer/binary",
        content=b"\xff\xd8\xff",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 200
    assert r.json() == _STUB_RESULT_JSON
    assert handler.got_binary == b"\xff\xd8\xff"
    assert handler.got_tensors is None


def test_infer_malformed_tensors_body_is_422_with_message(client):
    # A tensors body that does not match the TensorInput schema (missing shape/data)
    # is rejected by FastAPI validation and rendered in the Error schema.
    _install_model(_StubHandler())
    r = client.post("/models/m/infer/tensors", json={"x": {"datatype": "FP32"}})
    assert r.status_code == 422
    assert "message" in r.json()
    assert "detail" not in r.json()


def test_infer_handler_valueerror_is_422_with_message(client):
    _install_model(_StubHandler(raise_message="cannot decode image"))
    r = client.post(
        "/models/m/infer/binary",
        content=b"x",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 422
    assert r.json() == {"message": "cannot decode image"}


class _BoomHandler(Handler):
    """Raises a non-ValueError to exercise the unexpected-failure path."""

    task = Task.tensor

    def preprocess(self, binary, tensors, params):
        raise RuntimeError("kaboom")

    def postprocess(self, outputs, context, params):  # pragma: no cover - never reached
        return TensorResult(task="tensor", tensors={})


def test_infer_unexpected_error_is_500_with_message(client):
    _install_model(_BoomHandler())
    r = client.post("/models/m/infer/tensors", json={})
    assert r.status_code == 500
    # Internal detail ("kaboom") is logged, not leaked to the client.
    assert r.json() == {"message": "inference failed"}


def test_unhandled_error_renders_error_shape(monkeypatch):
    # An error that escapes an endpoint's own try block hits the framework-level
    # path. The global handler must still render the Error schema, not Starlette's
    # plaintext 500.
    app.state.models = {}
    _install_model(_StubHandler())

    def boom(_app):
        raise RuntimeError("boom")

    monkeypatch.setattr("app.main._models", boom)
    boom_client = TestClient(app, raise_server_exceptions=False)
    r = boom_client.get("/models")
    assert r.status_code == 500
    assert r.json() == {"message": "internal error"}


def test_infer_oversized_upload_is_413(client, monkeypatch):
    # Exercises the in-handler read backstop: the body is small enough to pass
    # the Content-Length middleware (which holds the real 32 MB cap), so the
    # monkeypatched MAX_UPLOAD_BYTES is what rejects it.
    import app.main as main_module

    monkeypatch.setattr(main_module, "MAX_UPLOAD_BYTES", 4)
    _install_model(_StubHandler())
    r = client.post(
        "/models/m/infer/binary",
        content=b"way too long",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert r.status_code == 413
    assert "exceeds" in r.json()["message"]


def test_list_models_coerces_numeric_version(client):
    app.state.models = {
        "m": LoadedModel(
            name="m",
            session=None,
            handler=_StubHandler(),
            manifest=Manifest(
                schemaVersion=1, handler="builtin:stub", model="m.onnx", params={"version": 2}
            ),
        )
    }
    r = client.get("/models")
    assert r.json()["models"][0]["modelVersion"] == "2"
