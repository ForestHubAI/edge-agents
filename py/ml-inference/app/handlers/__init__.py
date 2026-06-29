"""Pre/post-processing handlers (built-in registry + custom-file loading).

Importing this package registers the built-in handlers (their ``@register_builtin``
decorators run on import), so ``builtin:<name>`` lookups in the registry resolve.
"""

from . import raw, yolo  # noqa: F401  (imported for their handler registration side effect)
