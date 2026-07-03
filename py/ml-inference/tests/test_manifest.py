"""Tests for bundle-manifest parsing and the deploy-time validation gate."""

from __future__ import annotations

import pytest

from app.manifest import ManifestError, load_manifest


def _write(bundle, text: str) -> None:
    (bundle / "manifest.yaml").write_text(text)


def test_loads_valid_manifest(tmp_path):
    _write(
        tmp_path,
        "schemaVersion: 1\nhandler: builtin:raw\nmodel: model.onnx\nparams:\n  size: 640\n",
    )
    m = load_manifest(tmp_path)
    assert m.handler == "builtin:raw"
    assert m.model == "model.onnx"
    assert m.params == {"size": 640}


def test_missing_manifest_raises(tmp_path):
    with pytest.raises(ManifestError, match="no manifest.yaml"):
        load_manifest(tmp_path)


def test_invalid_yaml_raises(tmp_path):
    _write(tmp_path, "handler: [unclosed\n")
    with pytest.raises(ManifestError, match="not valid YAML"):
        load_manifest(tmp_path)


def test_wrong_schema_version_raises(tmp_path):
    _write(tmp_path, "schemaVersion: 2\nhandler: builtin:raw\nmodel: model.onnx\n")
    with pytest.raises(ManifestError, match="schemaVersion"):
        load_manifest(tmp_path)


def test_missing_required_field_raises(tmp_path):
    # No handler field — pydantic rejects it, wrapped as ManifestError.
    _write(tmp_path, "schemaVersion: 1\nmodel: model.onnx\n")
    with pytest.raises(ManifestError, match="invalid manifest"):
        load_manifest(tmp_path)
