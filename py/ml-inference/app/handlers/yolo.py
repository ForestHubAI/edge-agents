"""Built-in object-detection handler (YOLO family).

Implements the ``object-detection`` task for single-stage YOLO models exported to
ONNX (e.g. YOLOv8). Pre-processing letterboxes the image to the model input size;
post-processing decodes boxes, filters by confidence, applies non-maximum
suppression, maps class ids to labels and projects boxes back to original-image
pixel coordinates.

Assumed model output: one tensor of shape ``(1, 4 + num_classes, num_anchors)`` (or
its transpose), where the first four rows are box center x/y and width/height in
the letterboxed input scale and the remaining rows are per-class scores. This
matches the standard Ultralytics YOLOv8 ONNX export.

Handler params (all optional, read from the manifest/request ``params``):
``input`` (``{width, height}``; falls back to the model's declared input shape),
``labels`` (a labels filename in the bundle), ``confThreshold``, ``nmsThreshold``.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any

import cv2
import numpy as np
from PIL import Image

from .base import Feed, Handler
from .registry import register_builtin

if TYPE_CHECKING:
    from onnxruntime import InferenceSession

    from ..manifest import Manifest

DEFAULT_CONF_THRESHOLD = 0.25
DEFAULT_NMS_THRESHOLD = 0.45
PAD_VALUE = 114  # neutral gray used by the standard YOLO letterbox
# Bounds the decoded frame: the upload cap limits the encoded blob, but a tiny
# highly-compressible image can decode to gigabytes of pixels. Checked against the
# header dimensions before decoding, since cv2.imdecode allocates the full bitmap.
MAX_PIXELS = 50_000_000


@dataclass
class _LetterboxCtx:
    """Geometry needed to project boxes back onto the original image."""

    orig_w: int
    orig_h: int
    scale: float
    pad_x: int
    pad_y: int


@register_builtin("yolo")
class YoloHandler(Handler):
    """Object-detection pre/post-processing for YOLO-family ONNX models."""

    def load(self, session: InferenceSession, manifest: Manifest, bundle_dir: Path) -> None:
        self._input_name = session.get_inputs()[0].name
        self._width, self._height = self._resolve_input_size(manifest.params, session)
        self._labels = self._load_labels(manifest.params, bundle_dir)

    @staticmethod
    def _resolve_input_size(params: dict[str, Any], session: InferenceSession) -> tuple[int, int]:
        cfg = params.get("input") or {}
        width, height = cfg.get("width"), cfg.get("height")
        if not width or not height:
            # ONNX input is NCHW: [batch, channels, height, width].
            shape = session.get_inputs()[0].shape
            model_h, model_w = shape[2], shape[3]
            width = width or (model_w if isinstance(model_w, int) else None)
            height = height or (model_h if isinstance(model_h, int) else None)
        if not width or not height:
            raise ValueError(
                "YOLO handler needs an input size: set params.input.{width,height} "
                "or export the model with a fixed input shape"
            )
        return int(width), int(height)

    @staticmethod
    def _load_labels(params: dict[str, Any], bundle_dir: Path) -> list[str]:
        name = params.get("labels")
        if not name:
            return []
        # Keep the labels file inside the bundle, like the model path guard —
        # cheap insurance even though bundles are operator-trusted.
        path = (bundle_dir / name).resolve()
        if not path.is_relative_to(bundle_dir.resolve()):
            raise ValueError(f"labels path escapes the bundle: {name}")
        return path.read_text().splitlines()

    def preprocess(
        self,
        binary: bytes | None,
        tensors: dict[str, Any] | None,
        params: dict[str, Any],
    ) -> tuple[Feed, Any]:
        if binary is None:
            raise ValueError("object-detection expects an image in the 'binary' input")
        # Read the dimensions from the header (no pixel decode) and reject an
        # oversized frame before cv2.imdecode allocates the full bitmap.
        try:
            with Image.open(BytesIO(binary)) as probe:
                pw, ph = probe.size
        except Exception as e:
            raise ValueError("could not decode the image bytes") from e
        if pw * ph > MAX_PIXELS:
            raise ValueError("image exceeds the maximum allowed pixel count")
        img = cv2.imdecode(np.frombuffer(binary, dtype=np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("could not decode the image bytes")
        orig_h, orig_w = img.shape[:2]
        canvas, scale, pad_x, pad_y = self._letterbox(img)
        rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB)
        chw = np.transpose(rgb.astype(np.float32) / 255.0, (2, 0, 1))  # HWC -> CHW
        feed = {self._input_name: chw[np.newaxis, ...]}  # add the batch dimension
        return feed, _LetterboxCtx(orig_w, orig_h, scale, pad_x, pad_y)

    def _letterbox(self, img: np.ndarray) -> tuple[np.ndarray, float, int, int]:
        h, w = img.shape[:2]
        scale = min(self._width / w, self._height / h)
        nw, nh = int(round(w * scale)), int(round(h * scale))
        resized = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
        canvas = np.full((self._height, self._width, 3), PAD_VALUE, dtype=np.uint8)
        pad_x, pad_y = (self._width - nw) // 2, (self._height - nh) // 2
        canvas[pad_y : pad_y + nh, pad_x : pad_x + nw] = resized
        return canvas, scale, pad_x, pad_y

    def postprocess(
        self,
        outputs: list[np.ndarray],
        context: Any,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        conf_th = float(params.get("confThreshold", DEFAULT_CONF_THRESHOLD))
        nms_th = float(params.get("nmsThreshold", DEFAULT_NMS_THRESHOLD))

        pred = np.asarray(outputs[0])
        if pred.ndim == 3:  # drop the batch dimension
            pred = pred[0]
        if pred.shape[0] < pred.shape[1]:  # -> (num_anchors, 4 + num_classes)
            pred = pred.T

        boxes_cxcywh = pred[:, :4]
        class_scores = pred[:, 4:]
        confs = class_scores.max(axis=1)
        class_ids = class_scores.argmax(axis=1)

        keep = confs >= conf_th
        boxes_cxcywh, confs, class_ids = boxes_cxcywh[keep], confs[keep], class_ids[keep]
        if len(boxes_cxcywh) == 0:
            return {"detections": []}

        # center (cx, cy, w, h) -> top-left (x, y, w, h), still in letterbox coords
        top_left = boxes_cxcywh[:, :2] - boxes_cxcywh[:, 2:] / 2
        boxes_xywh = np.concatenate([top_left, boxes_cxcywh[:, 2:]], axis=1)

        # Class-aware NMS (Ultralytics default): shift each box into a per-class
        # coordinate band so boxes of different classes never suppress each other.
        offset = class_ids.reshape(-1, 1) * (float(boxes_xywh.max()) + 1.0)
        nms_boxes = boxes_xywh.copy()
        nms_boxes[:, :2] += offset
        idxs = cv2.dnn.NMSBoxes(nms_boxes.tolist(), confs.tolist(), conf_th, nms_th)
        if len(idxs) == 0:
            return {"detections": []}

        detections = []
        for i in np.asarray(idxs).flatten():
            detections.append(
                {
                    "label": self._label(int(class_ids[i])),
                    "score": float(confs[i]),
                    "box": self._project_box(boxes_xywh[i], context),
                }
            )
        return {"detections": detections}

    def _project_box(self, box_xywh: np.ndarray, ctx: _LetterboxCtx) -> dict[str, float]:
        x, y, w, h = (float(v) for v in box_xywh)
        # undo the letterbox: remove padding, then rescale to original pixels
        ox = (x - ctx.pad_x) / ctx.scale
        oy = (y - ctx.pad_y) / ctx.scale
        ow, oh = w / ctx.scale, h / ctx.scale
        # clip to the image bounds
        ox, oy = max(0.0, min(ox, ctx.orig_w)), max(0.0, min(oy, ctx.orig_h))
        ow, oh = min(ow, ctx.orig_w - ox), min(oh, ctx.orig_h - oy)
        return {"x": round(ox, 2), "y": round(oy, 2), "w": round(ow, 2), "h": round(oh, 2)}

    def _label(self, class_id: int) -> str:
        if 0 <= class_id < len(self._labels):
            return self._labels[class_id]
        return str(class_id)
