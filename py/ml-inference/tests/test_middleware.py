"""Tests for the request-body size middleware.

Mounted on a minimal app with a tiny cap so the Content-Length gate can be
exercised without moving real megabytes.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware import MaxBodySizeMiddleware


def _client(max_bytes: int) -> TestClient:
    app = FastAPI()
    app.add_middleware(MaxBodySizeMiddleware, max_bytes=max_bytes)

    @app.post("/echo")
    async def echo() -> dict:
        return {"ok": True}

    @app.get("/ping")
    async def ping() -> dict:
        return {"ok": True}

    return TestClient(app)


def test_rejects_body_over_the_cap():
    r = _client(max_bytes=8).post("/echo", content=b"x" * 64)
    assert r.status_code == 413
    # The contract's Error schema — "message", never FastAPI's "detail".
    assert "exceeds" in r.json()["message"]
    assert "detail" not in r.json()


def test_allows_body_at_the_cap():
    # Length == cap is allowed; only a strictly larger body is rejected.
    r = _client(max_bytes=8).post("/echo", content=b"x" * 8)
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_passes_requests_without_a_body():
    # No Content-Length -> nothing to gate; the request flows through.
    r = _client(max_bytes=8).get("/ping")
    assert r.status_code == 200
