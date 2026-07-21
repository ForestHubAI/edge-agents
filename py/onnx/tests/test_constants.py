# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Drift guard: the component's path constants must equal the cross-language
contract at contract/component-constants.json (shared with the Go and TS twins).
Editing one side without the JSON turns this red."""

from __future__ import annotations

import json
from pathlib import Path

from app.config import CONFIG_FILE, EXIT_BAD_CONFIG, WORKSPACE_DIR

_CONTRACT = json.loads(
    (Path(__file__).resolve().parents[3] / "contract" / "component-constants.json").read_text()
)


def test_workspace_matches_contract() -> None:
    # The model repository is mounted at the standard component workspace path. It is a
    # constant, not configuration — the renderer's bind-mount target.
    assert WORKSPACE_DIR == _CONTRACT["paths"]["workspace"]


def test_config_file_matches_contract() -> None:
    # The boot config is mounted read-only at the standard component config path.
    assert CONFIG_FILE == _CONTRACT["paths"]["configFile"]


def test_bad_config_exit_matches() -> None:
    # Permanent boot-failure exit code, shared with the Go/JSON contract.
    assert EXIT_BAD_CONFIG == _CONTRACT["exitCodes"]["badConfig"]


def test_listen_port_matches_contract() -> None:
    # The image binds the contracted component port; the on-device resolver dials
    # http://ml-inference:<port>. The port lives only in the Dockerfile ENTRYPOINT
    # (uvicorn --port), so assert that literal against the contract.
    port = _CONTRACT["components"]["mlInference"]["port"]
    dockerfile = (Path(__file__).resolve().parents[1] / "Dockerfile").read_text()
    assert f'"--port", "{port}"' in dockerfile
    assert f"EXPOSE {port}" in dockerfile
