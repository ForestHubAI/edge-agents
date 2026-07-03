"""ASGI middleware for the inference service."""

from __future__ import annotations

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from .api.models import Error


def _content_length(scope: Scope) -> int | None:
    """The request's Content-Length header, or None when absent/unparsable."""
    for name, value in scope["headers"]:
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


class MaxBodySizeMiddleware:
    """Reject oversized request bodies at the ASGI edge.

    Starlette buffers a whole multipart body (spilling large file parts to a temp
    file) before the route runs, so an in-handler size check happens too late to
    prevent the buffering. This rejects a request whose Content-Length exceeds the
    cap up front, before the body is read. A request that arrives without a
    Content-Length still faces the in-handler read cap as a backstop.
    """

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            length = _content_length(scope)
            if length is not None and length > self.max_bytes:
                response = JSONResponse(
                    status_code=413,
                    content=Error(message=f"request body exceeds {self.max_bytes} bytes").model_dump(),
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
