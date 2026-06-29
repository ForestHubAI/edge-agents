"""Handler resolution: pick the handler a bundle's manifest asks for.

A manifest's ``handler`` field is one of:

- ``builtin:<name>`` — a handler shipped in this package, looked up by name.
- ``file:<relative.py>`` — a Python file inside the bundle, loaded at startup.

Security note: a ``file:`` handler is arbitrary Python executed with the
container's privileges. It is loaded under an operator-trusted assumption — the
bundle is supplied by whoever operates the device, the same trust level as the
mounted models and compose file. Do not mount handler files from untrusted
sources.
"""

from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path

from ..manifest import Manifest
from .base import Handler

BUILTIN_PREFIX = "builtin:"
FILE_PREFIX = "file:"

# name -> built-in handler class. Populated by @register_builtin in the handler
# modules; importing this package's handler modules registers them.
BUILTIN_HANDLERS: dict[str, type[Handler]] = {}


class HandlerError(Exception):
    """Raised when a manifest's handler cannot be resolved or loaded."""


def register_builtin(name: str):
    """Class decorator registering a built-in handler under ``builtin:<name>``."""

    def decorator(cls: type[Handler]) -> type[Handler]:
        BUILTIN_HANDLERS[name] = cls
        return cls

    return decorator


def resolve_handler(manifest: Manifest, bundle_dir: Path) -> Handler:
    """Resolve and instantiate the handler named by ``manifest.handler``."""
    spec = manifest.handler
    if spec.startswith(BUILTIN_PREFIX):
        name = spec[len(BUILTIN_PREFIX) :]
        cls = BUILTIN_HANDLERS.get(name)
        if cls is None:
            known = ", ".join(sorted(BUILTIN_HANDLERS)) or "none"
            raise HandlerError(f"unknown built-in handler '{name}' (known: {known})")
        return cls()
    if spec.startswith(FILE_PREFIX):
        rel = spec[len(FILE_PREFIX) :]
        return _load_file_handler(bundle_dir / rel)
    raise HandlerError(
        f"invalid handler '{spec}': expected '{BUILTIN_PREFIX}<name>' or '{FILE_PREFIX}<file.py>'"
    )


def _load_file_handler(path: Path) -> Handler:
    """Load a custom handler from a bundle's Python file (trusted operator code)."""
    if not path.is_file():
        raise HandlerError(f"handler file not found: {path}")
    module_spec = importlib.util.spec_from_file_location(path.stem, path)
    if module_spec is None or module_spec.loader is None:
        raise HandlerError(f"could not load handler file: {path}")
    module = importlib.util.module_from_spec(module_spec)
    try:
        module_spec.loader.exec_module(module)
    except Exception as e:
        raise HandlerError(f"error importing handler file {path}: {e}") from e
    for obj in vars(module).values():
        if inspect.isclass(obj) and issubclass(obj, Handler) and obj is not Handler:
            return obj()
    raise HandlerError(f"no Handler subclass found in {path}")
