# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""The model repository: turn a mounted directory of bundles into a registry.

At startup the sidecar scans the models directory — one ``<model-id>/`` sub-folder
per model — and loads every bundle (ONNX session + resolved handler + manifest)
into a ``name -> LoadedModel`` map. One container thus hosts many models; a request
selects one by name. Loading is eager and fail-fast: an empty directory or any
single bad bundle aborts startup, so a misconfigured deployment never serves.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import onnxruntime as ort

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


def load_repository(models_dir: str | Path) -> dict[str, LoadedModel]:
    """Load every ``<model-id>/`` bundle under ``models_dir`` into a name->model map."""
    root = Path(models_dir)
    if not root.is_dir():
        raise RepositoryError(f"models directory not found: {root}")

    models: dict[str, LoadedModel] = {}
    for bundle_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        model_id = bundle_dir.name
        try:
            manifest = load_manifest(bundle_dir)
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

    if not models:
        raise RepositoryError(f"no model bundles found in {root}")
    return models
