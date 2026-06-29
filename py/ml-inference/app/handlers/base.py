"""Handler interface.

A handler turns a model's raw input into an ONNX Runtime feed, and the model's
raw output into the structured ``result`` object the service returns. Built-in
handlers ship in this package; custom handlers are loaded from a bundle's
``file:handler.py``. Every model names a handler; the built-in ``raw`` handler
feeds named tensors straight through for models that need no pre/post-processing.

A handler implements:

- ``task``: class attribute naming the task the handler implements.
- ``load(session, manifest, bundle_dir)``: one-time setup at startup (read labels,
  cache the model input shape, ...). Default is a no-op.
- ``preprocess(binary, tensors, params) -> (feed, context)``: build the ORT feed
  dict; ``context`` is handler-defined state handed on to ``postprocess``.
- ``postprocess(outputs, context, params) -> result``: turn ORT outputs into the
  structured result object.

``params`` is the manifest params merged with the request params (request wins).
Input is generic: a model uses ``binary`` (e.g. an image), ``tensors`` (named
numeric arrays), or both — whichever its handler expects.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

if TYPE_CHECKING:
    from onnxruntime import InferenceSession

    from ..manifest import Manifest

# An ONNX Runtime feed: input-tensor name -> array.
Feed = dict[str, np.ndarray]


class Handler(ABC):
    """Per-model-type pre/post-processing. See the module docstring for the interface."""

    task: str

    def load(self, session: InferenceSession, manifest: Manifest, bundle_dir: Path) -> None:
        """One-time setup at startup. Override to cache labels, input shape, etc."""

    @abstractmethod
    def preprocess(
        self,
        binary: bytes | None,
        tensors: dict[str, Any] | None,
        params: dict[str, Any],
    ) -> tuple[Feed, Any]:
        """Build the ORT feed; return ``(feed, context)`` where context feeds postprocess."""

    @abstractmethod
    def postprocess(
        self,
        outputs: list[np.ndarray],
        context: Any,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        """Turn ORT outputs into the structured ``result`` object."""
