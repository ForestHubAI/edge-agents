"""Tests for the model-repository loader.

Only the fail-fast error paths are covered here — they run without ONNX weights.
A successful load needs a real model file, which the weights-free suite avoids.
"""

from __future__ import annotations

import pytest

from app.repository import RepositoryError, load_repository


def test_missing_directory_raises():
    with pytest.raises(RepositoryError, match="not found"):
        load_repository("/no/such/models/dir")


def test_empty_directory_raises(tmp_path):
    with pytest.raises(RepositoryError, match="no model bundles"):
        load_repository(tmp_path)


def test_bundle_without_manifest_raises(tmp_path):
    (tmp_path / "model-a").mkdir()
    with pytest.raises(RepositoryError, match="manifest"):
        load_repository(tmp_path)


def test_missing_model_file_raises(tmp_path):
    bundle = tmp_path / "model-a"
    bundle.mkdir()
    (bundle / "manifest.yaml").write_text(
        "schemaVersion: 1\nhandler: builtin:raw\nmodel: model.onnx\n"
    )
    with pytest.raises(RepositoryError, match="model file not found"):
        load_repository(tmp_path)
