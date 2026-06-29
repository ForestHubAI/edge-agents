"""Unit tests for the raw passthrough handler.

A lightweight fake session stands in for ONNX Runtime, so these run without the
native runtime or a model: they pin the dtype casting, the named-output mapping
and the input-validation errors.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.handlers.raw import RawHandler


class _IO:
    def __init__(self, name, type=None):
        self.name = name
        self.type = type


class _FakeSession:
    """Declares one float32 input "x" and one output "y" that doubles the input."""

    def get_inputs(self):
        return [_IO("x", "tensor(float)")]

    def get_outputs(self):
        return [_IO("y")]

    def run(self, _outputs, feed):
        return [feed["x"] * 2]


def _loaded_handler():
    handler = RawHandler()
    handler.load(_FakeSession(), None, None)
    return handler


def test_preprocess_casts_to_declared_dtype():
    # input given as Python ints -> must be cast to the model's float32
    feed, ctx = _loaded_handler().preprocess(None, {"x": [[1, 2, 3]]}, {})
    assert feed["x"].dtype == np.float32
    assert ctx is None


def test_postprocess_maps_outputs_by_name():
    handler = _loaded_handler()
    feed, _ = handler.preprocess(None, {"x": [[1.0, 2.0, 3.0]]}, {})
    result = handler.postprocess(_FakeSession().run(None, feed), None, {})
    assert result == {"outputs": {"y": [[2.0, 4.0, 6.0]]}}


def test_missing_tensors_raises():
    with pytest.raises(ValueError, match="tensors"):
        _loaded_handler().preprocess(None, None, {})


def test_unknown_tensor_name_raises():
    with pytest.raises(ValueError, match="bogus"):
        _loaded_handler().preprocess(None, {"bogus": [1]}, {})
