# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Pre/post-processing handlers (built-in registry + custom-file loading).

Importing this package registers the built-in handlers (their ``@register_builtin``
decorators run on import), so ``builtin:<name>`` lookups in the registry resolve.
"""

from . import raw, yolo  # noqa: F401  (imported for their handler registration side effect)
