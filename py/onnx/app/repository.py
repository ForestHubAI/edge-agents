# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""The model repository: turn the issued bundles into a registry.

The boot config names which ``<model-id>/`` sub-folders of the mounted workspace this
component is issued, and it is **authoritative**: exactly those bundles are loaded
(ONNX session + resolved handler + manifest) into a ``name -> LoadedModel`` map. A
declared bundle that is absent or broken aborts startup; an undeclared sub-folder is
ignored, never loaded implicitly. One container thus hosts many models and a request
selects one by name. Loading is eager and fail-fast, so a misconfigured deployment
never serves.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import onnxruntime as ort

from .api.models import MLModelConfig
from .handlers.base import Handler
from .handlers.registry import resolve_handler
from .manifest import Manifest, load_manifest


@dataclass
class LoadedModel:
    """One ready-to-serve model: its ORT session, handler and manifest."""

    name: str
    session: ort.InferenceSession
    handler: Handler
    manifest: Manifest


class RepositoryError(Exception):
    """Raised when the models repository cannot be loaded."""


def load_repository(
    models_dir: str | Path, declared: dict[str, MLModelConfig]
) -> dict[str, LoadedModel]:
    """Load exactly the ``declared`` bundles under ``models_dir`` into a name->model map.

    ``declared`` comes from the boot config and is authoritative — a bundle named there
    but missing from the repository is a permanent failure, and a sub-folder present but
    not named is left alone.
    """
    root = Path(models_dir)
    if not root.is_dir():
        raise RepositoryError(f"models directory not found: {root}")

    models: dict[str, LoadedModel] = {}
    for model_id, model_cfg in sorted(declared.items()):
        bundle_dir = root / model_id
        if not bundle_dir.is_dir():
            raise RepositoryError(
                f"model '{model_id}' is declared in the boot config but no bundle "
                f"directory exists at {bundle_dir} — stage the bundle in the workspace"
            )
        try:
            manifest = load_manifest(bundle_dir)
            # The deployment's params override the bundle's own defaults; a request's
            # params override both at inference time.
            if model_cfg.params:
                manifest = manifest.model_copy(
                    update={"params": {**manifest.params, **model_cfg.params}}
                )
            model_path = manifest.model_path(bundle_dir)
            if not model_path.is_file():
                raise RepositoryError(f"model file not found: {model_path}")
            # onnxruntime reports EACCES only as a cryptic "system error number 13".
            if not os.access(model_path, os.R_OK):
                raise RepositoryError(
                    f"model file is not readable: {model_path} — "
                    "fix the file permissions on the host (e.g. chmod 644)"
                )
            session = ort.InferenceSession(
                str(model_path), providers=["CPUExecutionProvider"]
            )
            handler = resolve_handler(manifest, bundle_dir)
            handler.load(session, manifest, bundle_dir)
        except Exception as e:
            raise RepositoryError(f"failed to load model '{model_id}': {e}") from e
        models[model_id] = LoadedModel(
            name=model_id, session=session, handler=handler, manifest=manifest
        )

    # An empty result is impossible: load_boot_config rejects a config declaring no
    # models, and every declared model either loaded or raised above.
    return models
