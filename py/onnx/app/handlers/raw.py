# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Built-in passthrough handler (named tensors in, named tensors out).

For models that need no pre/post-processing: the request supplies the model's
input tensors by name as typed ``Tensor`` values (KServe/OIP — ``datatype`` +
``shape`` over a flat ``data`` array), each is reshaped and fed into the session
with the dtype the model declares, and every output tensor is returned by name as a
typed ``Tensor``. This is the generic fit for classical ML (decision tree, SVM,
random forest exported via skl2onnx), time-series and embedding models.

Task: ``tensor`` — the contract does not model these outputs, so they are returned
raw, keyed by the model's output names, and the caller owns interpreting them.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

from ..api.models import Datatype, Task, Tensor, TensorResult
from .base import Feed, Handler
from .registry import register_builtin

if TYPE_CHECKING:
    from pathlib import Path

    from onnxruntime import InferenceSession

    from ..manifest import Manifest

# ONNX Runtime input-type string (e.g. "tensor(float)") -> numpy dtype. Casting
# to the declared dtype avoids feeding float64/int64 into a model expecting
# float32/int32, which ORT rejects.
_DTYPES = {
    "tensor(float)": np.float32,
    "tensor(double)": np.float64,
    "tensor(float16)": np.float16,
    "tensor(int64)": np.int64,
    "tensor(int32)": np.int32,
    "tensor(int16)": np.int16,
    "tensor(int8)": np.int8,
    "tensor(uint8)": np.uint8,
    "tensor(uint16)": np.uint16,
    "tensor(uint32)": np.uint32,
    "tensor(uint64)": np.uint64,
    "tensor(bool)": np.bool_,
}

# numpy dtype kind+itemsize -> KServe/OIP datatype, for typing output tensors on the
# wire. Keyed by numpy's dtype name so an output's dtype maps to its contract spelling.
_OIP_DATATYPES = {
    "bool": Datatype.BOOL,
    "uint8": Datatype.UINT8,
    "uint16": Datatype.UINT16,
    "uint32": Datatype.UINT32,
    "uint64": Datatype.UINT64,
    "int8": Datatype.INT8,
    "int16": Datatype.INT16,
    "int32": Datatype.INT32,
    "int64": Datatype.INT64,
    "float16": Datatype.FP16,
    "float32": Datatype.FP32,
    "float64": Datatype.FP64,
}


@register_builtin("raw")
class RawHandler(Handler):
    """Feed named input tensors straight through and return named outputs."""

    task = Task.tensor

    def load(self, session: InferenceSession, manifest: Manifest, bundle_dir: Path) -> None:
        self._input_dtypes = {i.name: _DTYPES.get(i.type) for i in session.get_inputs()}
        self._output_names = [o.name for o in session.get_outputs()]

    def preprocess(
        self,
        binary: bytes | None,
        tensors: dict[str, Tensor] | None,
        params: dict[str, Any],
    ) -> tuple[Feed, Any]:
        if not tensors:
            raise ValueError("raw handler expects input in the 'tensors' field")
        unknown = set(tensors) - set(self._input_dtypes)
        if unknown:
            known = ", ".join(sorted(self._input_dtypes)) or "none"
            raise ValueError(f"unknown input tensors {sorted(unknown)} (model inputs: {known})")
        # Reshape the flat, row-major data to its declared shape, then cast to the
        # model's own input dtype (authoritative — the Tensor's datatype is
        # self-describing metadata). A data/shape length mismatch raises -> 422.
        try:
            feed = {
                name: np.asarray(t.data, dtype=self._input_dtypes[name]).reshape(t.shape)
                for name, t in tensors.items()
            }
        except ValueError as e:
            raise ValueError(f"tensor does not match its declared shape: {e}") from e
        return feed, None

    def postprocess(
        self,
        outputs: list[np.ndarray],
        context: Any,
        params: dict[str, Any],
    ) -> TensorResult:
        return TensorResult(
            task="tensor",
            tensors={name: _to_tensor(out) for name, out in zip(self._output_names, outputs)},
        )


def _to_tensor(out: np.ndarray) -> Tensor:
    """Encode a numpy output as a typed, self-describing wire Tensor."""
    arr = np.asarray(out)
    datatype = _OIP_DATATYPES.get(arr.dtype.name)
    if datatype is None:
        raise ValueError(f"model produced an unsupported output dtype: {arr.dtype.name}")
    return Tensor(datatype=datatype, shape=list(arr.shape), data=arr.flatten().tolist())
