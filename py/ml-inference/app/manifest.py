# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Bundle manifest schema and loader.

Each model bundle is a sub-folder of the models repository and carries a
`manifest.yaml` describing how to load and drive its model. The manifest is
validated when the repository loads at startup; an invalid manifest fails the
whole sidecar fast — this is the deploy-time validation gate.
"""

from __future__ import annotations

from pathlib import Path

import yaml
from pydantic import BaseModel, Field, ValidationError, field_validator

# The manifest schema version this build understands. A bundle declaring any
# other value is rejected, so model weights, manifest format and handler ABI
# cannot silently drift apart.
SCHEMA_VERSION = 1


class ManifestError(Exception):
    """Raised when a bundle manifest is missing or invalid."""


class Manifest(BaseModel):
    """A model bundle's self-description (`manifest.yaml`).

    Only universal fields are typed here — identity (`schemaVersion`, `handler`,
    `model`) plus a free-form `params` bag. Everything model- or task-specific
    (input size, labels, thresholds, ...) lives in `params` and is interpreted by
    the selected handler, so the schema stays model-type-agnostic.
    """

    schemaVersion: int
    handler: str
    model: str
    params: dict = Field(default_factory=dict)

    @field_validator("schemaVersion")
    @classmethod
    def _check_version(cls, v: int) -> int:
        if v != SCHEMA_VERSION:
            raise ValueError(
                f"unsupported manifest schemaVersion {v}, expected {SCHEMA_VERSION}"
            )
        return v

    def model_path(self, bundle_dir: Path) -> Path:
        """Absolute path to the ONNX model file, resolved inside the bundle.

        Rejects a `model` that escapes the bundle directory (e.g. `../other`);
        the bundle is operator-trusted, but a contained path is cheap insurance.
        """
        resolved = (bundle_dir / self.model).resolve()
        if not resolved.is_relative_to(bundle_dir.resolve()):
            raise ManifestError(f"model path escapes the bundle: {self.model}")
        return resolved


def load_manifest(bundle_dir: Path) -> Manifest:
    """Parse and validate `<bundle_dir>/manifest.yaml`, failing fast on any error."""
    path = bundle_dir / "manifest.yaml"
    if not path.is_file():
        raise ManifestError(f"no manifest.yaml in {bundle_dir}")
    try:
        data = yaml.safe_load(path.read_text())
    except yaml.YAMLError as e:
        raise ManifestError(f"manifest.yaml in {bundle_dir} is not valid YAML: {e}") from e
    try:
        return Manifest.model_validate(data)
    except ValidationError as e:
        raise ManifestError(f"invalid manifest in {bundle_dir}: {e}") from e
