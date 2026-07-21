# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Unit tests for the raw passthrough handler.

A lightweight fake session stands in for ONNX Runtime, so these run without the
native runtime or a model: they pin the typed-Tensor round-trip (flat data +
shape in, flat data + shape + datatype out), the dtype casting, the named-output
mapping and the input-validation errors.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.api.models import Datatype, Tensor
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


def _tensor(datatype, shape, data):
    return Tensor(datatype=datatype, shape=shape, data=data)


def test_preprocess_reshapes_and_casts_to_declared_dtype():
    # Flat data + shape given as ints -> reshaped and cast to the model's float32.
    feed, ctx = _loaded_handler().preprocess(
        None, {"x": _tensor(Datatype.INT64, [1, 3], [1, 2, 3])}, {}
    )
    assert feed["x"].dtype == np.float32
    assert feed["x"].shape == (1, 3)
    assert feed["x"].tolist() == [[1.0, 2.0, 3.0]]
    assert ctx is None


def test_postprocess_maps_outputs_by_name_as_typed_tensors():
    handler = _loaded_handler()
    feed, _ = handler.preprocess(None, {"x": _tensor(Datatype.FP32, [1, 3], [1.0, 2.0, 3.0])}, {})
    result = handler.postprocess(_FakeSession().run(None, feed), None, {})
    assert result.task == "tensor"
    out = result.tensors["y"]
    assert out.datatype == Datatype.FP32
    assert out.shape == [1, 3]
    assert out.data == [2.0, 4.0, 6.0]  # flat, row-major


def test_shape_mismatch_raises():
    # data length (2) does not match the product of shape (3) -> ValueError -> 422.
    with pytest.raises(ValueError, match="shape"):
        _loaded_handler().preprocess(None, {"x": _tensor(Datatype.FP32, [3], [1.0, 2.0])}, {})


def test_missing_tensors_raises():
    with pytest.raises(ValueError, match="tensors"):
        _loaded_handler().preprocess(None, None, {})


def test_unknown_tensor_name_raises():
    with pytest.raises(ValueError, match="bogus"):
        _loaded_handler().preprocess(None, {"bogus": _tensor(Datatype.FP32, [1], [1.0])}, {})
