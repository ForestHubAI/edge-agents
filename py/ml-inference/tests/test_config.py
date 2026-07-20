# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Tests for the boot-config loader — every rejection is a permanent boot failure."""

from __future__ import annotations

import json

import pytest

from app.config import ConfigError, load_boot_config


def _write(tmp_path, payload: str):
    path = tmp_path / "config.json"
    path.write_text(payload)
    return path


def test_missing_file_raises(tmp_path):
    with pytest.raises(ConfigError, match="no boot config"):
        load_boot_config(tmp_path / "config.json")


def test_malformed_json_raises(tmp_path):
    with pytest.raises(ConfigError, match="not valid JSON"):
        load_boot_config(_write(tmp_path, "{not json"))


def test_missing_models_key_raises(tmp_path):
    with pytest.raises(ConfigError, match="invalid boot config"):
        load_boot_config(_write(tmp_path, json.dumps({})))


def test_empty_models_raises(tmp_path):
    # A component issued no models can serve nothing; fail at boot rather than 404 on
    # every request.
    with pytest.raises(ConfigError, match="declares no models"):
        load_boot_config(_write(tmp_path, json.dumps({"models": {}})))


def test_loads_declared_models(tmp_path):
    config = load_boot_config(
        _write(tmp_path, json.dumps({"models": {"yolo": {}, "classifier": {}}}))
    )
    assert set(config.models) == {"yolo", "classifier"}
    assert config.models["yolo"].params is None


def test_loads_per_model_params(tmp_path):
    config = load_boot_config(
        _write(tmp_path, json.dumps({"models": {"yolo": {"params": {"confThreshold": 0.5}}}}))
    )
    assert config.models["yolo"].params == {"confThreshold": 0.5}
