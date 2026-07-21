# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Tests for handler resolution: built-ins, the file: custom-handler path, errors.

The file: path loads arbitrary operator-trusted Python from a bundle; these
tests exercise that load and its failure modes.
"""

from __future__ import annotations

import pytest

import app.handlers  # noqa: F401 — importing registers the built-in handlers
from app.handlers.base import Handler
from app.handlers.raw import RawHandler
from app.handlers.registry import HandlerError, resolve_handler
from app.manifest import Manifest


def _manifest(handler: str) -> Manifest:
    return Manifest(schemaVersion=1, handler=handler, model="model.onnx")


def test_resolves_builtin(tmp_path):
    assert isinstance(resolve_handler(_manifest("builtin:raw"), tmp_path), RawHandler)


def test_unknown_builtin_raises(tmp_path):
    with pytest.raises(HandlerError, match="unknown built-in"):
        resolve_handler(_manifest("builtin:ghost"), tmp_path)


def test_invalid_prefix_raises(tmp_path):
    with pytest.raises(HandlerError, match="invalid handler"):
        resolve_handler(_manifest("bogus"), tmp_path)


def test_file_handler_is_loaded(tmp_path):
    (tmp_path / "handler.py").write_text(
        "from app.handlers.base import Handler\n"
        "class MyHandler(Handler):\n"
        "    def preprocess(self, binary, tensors, params): return ({}, None)\n"
        "    def postprocess(self, outputs, context, params): return {}\n"
    )
    h = resolve_handler(_manifest("file:handler.py"), tmp_path)
    assert isinstance(h, Handler)
    assert type(h).__name__ == "MyHandler"


def test_file_handler_not_found_raises(tmp_path):
    with pytest.raises(HandlerError, match="not found"):
        resolve_handler(_manifest("file:missing.py"), tmp_path)


def test_file_without_handler_subclass_raises(tmp_path):
    (tmp_path / "handler.py").write_text("x = 1\n")
    with pytest.raises(HandlerError, match="no Handler subclass"):
        resolve_handler(_manifest("file:handler.py"), tmp_path)
