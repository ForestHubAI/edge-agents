# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Drift guard: the component's path constants must equal the cross-language
contract at contract/component-constants.json (shared with the Go and TS twins).
Editing one side without the JSON turns this red."""

from __future__ import annotations

import json
from pathlib import Path

from app.config import DEFAULT_MODELS_DIR, EXIT_BAD_CONFIG

_CONTRACT = json.loads(
    (Path(__file__).resolve().parents[3] / "contract" / "component-constants.json").read_text()
)


def test_models_dir_matches_workspace() -> None:
    # The model repository is mounted at the standard component workspace path.
    assert DEFAULT_MODELS_DIR == _CONTRACT["paths"]["workspace"]


def test_bad_config_exit_matches() -> None:
    # Permanent boot-failure exit code, shared with the Go/JSON contract.
    assert EXIT_BAD_CONFIG == _CONTRACT["exitCodes"]["badConfig"]
