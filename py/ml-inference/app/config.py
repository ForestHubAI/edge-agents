# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Runtime configuration, read from the environment once at startup."""

from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_MODELS_DIR = "/var/lib/foresthub/models"


@dataclass(frozen=True)
class Config:
    """Resolved component configuration."""

    models_dir: str


def load_config() -> Config:
    """Read configuration from the environment, falling back to defaults.

    The models repository is a directory of `<model-id>/` bundle sub-folders,
    mounted read-only into the container (default `/var/lib/foresthub/models`).
    """
    return Config(models_dir=os.getenv("ML_MODELS_DIR", DEFAULT_MODELS_DIR))
