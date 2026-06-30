"""Custom object-detection handler shipped inside the bundle.

Selected because this bundle's manifest sets `handler: file:handler.py` (instead
of `builtin:yolo`). It runs the same YOLO pipeline as the built-in handler, then
annotates the result with a detection `count` and a short `summary` — a visible
sign that this operator-supplied code is what produced the output.

Runs as operator-trusted code inside the container, with full access to the
image's installed packages.
"""

from __future__ import annotations

from typing import Any

# Import the built-in handler's MODULE (not `from ... import YoloHandler`): the
# loader instantiates the first Handler subclass it finds in this file, so keeping
# the base behind a module reference leaves CustomHandler as the only candidate.
import app.handlers.yolo as builtin_yolo


class CustomHandler(builtin_yolo.YoloHandler):
    """Reuse the built-in YOLO preprocess/postprocess, then annotate the result."""

    def postprocess(self, outputs, context, params) -> dict[str, Any]:
        result = super().postprocess(outputs, context, params)
        detections = result["detections"]
        result["count"] = len(detections)
        if detections:
            top = max(detections, key=lambda d: d["score"])
            result["summary"] = f"{result['count']} objects, top: {top['label']}"
        return result
