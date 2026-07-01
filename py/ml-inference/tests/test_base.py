"""Unit tests for the Handler base interface — the ``infer`` run step.

A lightweight fake session stands in for ONNX Runtime, so these run without the
native runtime or a model: they pin that the default ``infer`` is a single
forward pass and that a handler may override it to own the run loop (multi-pass
or autoregressive models).
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.handlers.base import Feed, Handler


class _FakeSession:
    """Doubles its input and counts how often it was run."""

    def __init__(self) -> None:
        self.calls = 0

    def run(self, _outputs, feed):
        self.calls += 1
        return [feed["x"] * 2]


class _MinimalHandler(Handler):
    """Concrete handler with no-op pre/post — only the run step is under test."""

    def preprocess(self, binary, tensors, params):
        return {"x": np.asarray(tensors["x"], dtype=np.float32)}, None

    def postprocess(self, outputs, context, params):
        return {"outputs": outputs}


class _TwoPassHandler(_MinimalHandler):
    """Overrides infer to run the session twice, feeding output back as input —
    the shape an autoregressive/generative handler needs."""

    def infer(self, session, feed: Feed, context: Any, params: dict[str, Any]):
        first = session.run(None, feed)
        return session.run(None, {"x": first[0]})


def test_default_infer_is_a_single_forward_pass():
    session = _FakeSession()
    feed = {"x": np.array([[1.0, 2.0]], dtype=np.float32)}

    outputs = _MinimalHandler().infer(session, feed, None, {})

    assert session.calls == 1
    assert np.array_equal(outputs[0], feed["x"] * 2)


def test_infer_can_be_overridden_to_run_multiple_passes():
    session = _FakeSession()
    feed = {"x": np.array([[1.0]], dtype=np.float32)}

    outputs = _TwoPassHandler().infer(session, feed, None, {})

    assert session.calls == 2
    # doubled twice: 1 -> 2 -> 4
    assert np.array_equal(outputs[0], np.array([[4.0]], dtype=np.float32))
