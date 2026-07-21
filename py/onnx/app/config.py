# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""The component contract's fixed paths, and the boot config read from them.

Two different things arrive at startup and must not be confused:

* **Process config** — the environment (`LOG_LEVEL`). Device-scoped, operator-authored
  in `<name>.env`, available at exec with no I/O.
* **Boot config** — `config.json` at the contracted path. Deployment-scoped, written by
  the renderer, regenerated every deploy. It says which model bundles this component is
  issued; see `MLConfig` in `contract/ml.yaml`.

The in-container paths are *constants, not configuration*: they are the renderer's
bind-mount targets, so a component that reads anywhere else reads an empty location.
"""

from __future__ import annotations

import json
from pathlib import Path

from pydantic import ValidationError

from .api.models import MLConfig

# The component contract's fixed in-container paths (see
# contract/component-constants.json and its Go/TS twins). The boot config is mounted
# read-only; the workspace holds the model repository this component loads from.
CONFIG_FILE = "/etc/foresthub/config.json"
WORKSPACE_DIR = "/var/lib/foresthub/workspace"

# Permanent-boot-failure exit code (sysexits EX_CONFIG). A bad config or an unloadable
# repository fails identically on restart, so the process exits this to tell the
# orchestrator to stop retrying. Mirrors contract/component-constants.json
# exitCodes.badConfig and go/component.ExitConfigError.
EXIT_BAD_CONFIG = 78


class ConfigError(Exception):
    """Raised when the boot config is missing or invalid."""


def load_boot_config(path: str | Path = CONFIG_FILE) -> MLConfig:
    """Read and validate `config.json`, failing fast on any error.

    The `path` argument exists for tests; production always reads the contracted
    constant, which is where the renderer mounts the file.
    """
    file = Path(path)
    if not file.is_file():
        raise ConfigError(f"no boot config at {file}")
    try:
        data = json.loads(file.read_text())
    except json.JSONDecodeError as e:
        raise ConfigError(f"{file} is not valid JSON: {e}") from e
    try:
        config = MLConfig.model_validate(data)
    except ValidationError as e:
        raise ConfigError(f"invalid boot config in {file}: {e}") from e
    # A component issued no models can serve nothing — every inference call would 404.
    # Fail here so the deployment is marked failed at boot, not at the engine's first call.
    if not config.models:
        raise ConfigError(f"{file} declares no models")
    return config
