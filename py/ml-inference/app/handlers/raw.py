"""Built-in passthrough handler (named tensors in, named tensors out).

For models that need no pre/post-processing: the request supplies the model's
input tensors by name (as nested numeric arrays), they are fed straight into the
session with the dtype the model declares, and every output tensor is returned by
name as a nested array. This is the generic fit for classical ML (decision tree,
SVM, random forest exported via skl2onnx), time-series and embedding models.

Result shape: ``{"outputs": {<output-name>: <nested-array>, ...}}``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np

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


@register_builtin("raw")
class RawHandler(Handler):
    """Feed named input tensors straight through and return named outputs."""

    def load(self, session: InferenceSession, manifest: Manifest, bundle_dir: Path) -> None:
        self._input_dtypes = {i.name: _DTYPES.get(i.type) for i in session.get_inputs()}
        self._output_names = [o.name for o in session.get_outputs()]

    def preprocess(
        self,
        binary: bytes | None,
        tensors: dict[str, Any] | None,
        params: dict[str, Any],
    ) -> tuple[Feed, Any]:
        if not tensors:
            raise ValueError("raw handler expects input in the 'tensors' field")
        unknown = set(tensors) - set(self._input_dtypes)
        if unknown:
            known = ", ".join(sorted(self._input_dtypes)) or "none"
            raise ValueError(f"unknown input tensors {sorted(unknown)} (model inputs: {known})")
        feed = {name: np.asarray(value, dtype=self._input_dtypes[name]) for name, value in tensors.items()}
        return feed, None

    def postprocess(
        self,
        outputs: list[np.ndarray],
        context: Any,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        return {"outputs": {name: np.asarray(out).tolist() for name, out in zip(self._output_names, outputs)}}
