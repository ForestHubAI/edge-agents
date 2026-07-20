# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Tests for the model-repository loader.

Only the fail-fast error paths are covered here — they run without ONNX weights.
A successful load needs a real model file, which the weights-free suite avoids.
"""

from __future__ import annotations

import os

import pytest

from app.api.models import MLModelConfig
from app.repository import RepositoryError, load_repository


def _declare(*names: str) -> dict[str, MLModelConfig]:
    """The boot config's model map for the given bundle ids, with no overrides."""
    return {name: MLModelConfig() for name in names}


def _write_manifest(bundle, params: str = "") -> None:
    bundle.mkdir()
    (bundle / "manifest.yaml").write_text(
        "schemaVersion: 1\nhandler: builtin:raw\nmodel: model.onnx\n" + params
    )


def test_missing_directory_raises():
    with pytest.raises(RepositoryError, match="not found"):
        load_repository("/no/such/models/dir", _declare("model-a"))


def test_declared_bundle_missing_raises(tmp_path):
    # Authoritative config: a declared bundle that was never staged is a hard failure,
    # not an empty repository.
    with pytest.raises(RepositoryError, match="declared in the boot config"):
        load_repository(tmp_path, _declare("model-a"))


def test_undeclared_bundle_is_ignored(tmp_path):
    # A sub-folder the component was not issued is left alone — not loaded, and not an
    # error. Only the declared (missing) one is reported.
    _write_manifest(tmp_path / "stray")
    with pytest.raises(RepositoryError, match="model-a"):
        load_repository(tmp_path, _declare("model-a"))


def test_bundle_without_manifest_raises(tmp_path):
    (tmp_path / "model-a").mkdir()
    with pytest.raises(RepositoryError, match="manifest"):
        load_repository(tmp_path, _declare("model-a"))


def test_missing_model_file_raises(tmp_path):
    _write_manifest(tmp_path / "model-a")
    with pytest.raises(RepositoryError, match="model file not found"):
        load_repository(tmp_path, _declare("model-a"))


@pytest.mark.skipif(os.geteuid() == 0, reason="root reads regardless of permissions")
def test_unreadable_model_file_raises(tmp_path):
    _write_manifest(tmp_path / "model-a")
    model = tmp_path / "model-a" / "model.onnx"
    model.write_bytes(b"")
    model.chmod(0o000)
    with pytest.raises(RepositoryError, match="not readable"):
        load_repository(tmp_path, _declare("model-a"))
