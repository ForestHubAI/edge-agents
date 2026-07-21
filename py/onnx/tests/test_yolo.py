# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (c) 2026 ForestHub. All rights reserved.
# For commercial licensing, contact root@foresthub.ai

"""Unit tests for the YOLO handler (preprocess + postprocess).

Synthetic images and output tensors are fed through the handler directly — no
ONNX model, no network. They pin the letterbox geometry and normalization on the
way in, and the confidence threshold, NMS, class-id -> label and letterbox
back-projection on the way out (the two halves are inverses of each other).
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from app.handlers.yolo import YoloHandler, _LetterboxCtx

LABELS = ["person", "bicycle", "car"]

# A 1280x640 image letterboxed into 640x640: scale 0.5, no horizontal padding,
# 160px vertical padding top/bottom. Shared by the geometry + back-projection tests.
CTX = _LetterboxCtx(orig_w=1280, orig_h=640, scale=0.5, pad_x=0, pad_y=160)


# --- preprocess -----------------------------------------------------------

def _preprocess_handler(width=640, height=640):
    handler = YoloHandler()
    handler._input_name = "images"
    handler._width = width
    handler._height = height
    return handler


def _png_bytes(width, height):
    img = np.zeros((height, width, 3), dtype=np.uint8)  # (H, W, C)
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


def test_feed_is_normalized_nchw():
    feed, _ = _preprocess_handler().preprocess(_png_bytes(1280, 640), None, {})
    tensor = feed["images"]
    assert tensor.shape == (1, 3, 640, 640)  # batch, channels, height, width
    assert tensor.dtype == np.float32
    assert 0.0 <= float(tensor.max()) <= 1.0  # scaled into [0, 1]


def test_letterbox_geometry():
    # a 1280x640 image into 640x640: scale 0.5, no x-padding, 160px y-padding
    _, ctx = _preprocess_handler().preprocess(_png_bytes(1280, 640), None, {})
    assert ctx.orig_w == 1280
    assert ctx.orig_h == 640
    assert ctx.scale == 0.5
    assert ctx.pad_x == 0
    assert ctx.pad_y == 160


def test_missing_binary_raises():
    with pytest.raises(ValueError, match="binary"):
        _preprocess_handler().preprocess(None, None, {})


def test_undecodable_bytes_raise():
    with pytest.raises(ValueError, match="decode"):
        _preprocess_handler().preprocess(b"not an image", None, {})


def test_oversized_image_is_rejected_before_decode(monkeypatch):
    # An image whose header dimensions exceed the pixel cap (a decompression bomb)
    # is rejected before cv2.imdecode allocates. Cap lowered so no real bomb needed.
    import app.handlers.yolo as yolo

    monkeypatch.setattr(yolo, "MAX_PIXELS", 100)
    with pytest.raises(ValueError, match="pixel count"):
        _preprocess_handler().preprocess(_png_bytes(640, 640), None, {})


# --- labels ---------------------------------------------------------------

def test_labels_are_loaded_from_the_bundle(tmp_path):
    (tmp_path / "coco.txt").write_text("person\nbicycle\n")
    assert YoloHandler._load_labels({"labels": "coco.txt"}, tmp_path) == ["person", "bicycle"]


def test_labels_path_escaping_the_bundle_is_rejected(tmp_path):
    with pytest.raises(ValueError, match="escapes the bundle"):
        YoloHandler._load_labels({"labels": "../secrets.txt"}, tmp_path)


# --- postprocess ----------------------------------------------------------

def _detections(anchors, ctx=CTX, params=None):
    """Run postprocess on hand-built anchors (cx, cy, w, h, [class scores])."""
    rows = [[cx, cy, w, h, *scores] for cx, cy, w, h, scores in anchors]
    # Pad with zero-score background anchors so the number of anchors exceeds the
    # feature count — this matches the real (1, 4+classes, anchors) layout and the
    # handler's transpose heuristic.
    n_features = 4 + len(LABELS)
    while len(rows) <= n_features:
        rows.append([0.0, 0.0, 1.0, 1.0, *([0.0] * len(LABELS))])

    arr = np.array(rows, dtype=np.float32)  # (anchors, features)
    output = arr.T[np.newaxis, ...]  # (1, features, anchors) — raw YOLOv8 layout

    handler = YoloHandler()
    handler._labels = LABELS
    return handler.postprocess([output], ctx, params or {})


def test_below_threshold_is_dropped():
    # max class score 0.1 < default confThreshold 0.25 -> no detection
    dets = _detections([(320, 240, 100, 120, [0.1, 0.05, 0.05])])
    assert dets["detections"] == []


def test_nms_collapses_overlapping_boxes():
    # two nearly identical "person" boxes -> NMS keeps only the higher-scoring one
    dets = _detections(
        [
            (320, 240, 100, 120, [0.9, 0.1, 0.05]),  # person, conf 0.9
            (323, 242, 100, 120, [0.8, 0.1, 0.05]),  # person, overlaps -> dropped
        ]
    )["detections"]
    assert len(dets) == 1
    assert dets[0]["label"] == "person"
    assert abs(dets[0]["score"] - 0.9) < 1e-5  # the 0.9 box survived, not the 0.8


def test_overlapping_different_classes_are_both_kept():
    # two boxes at the same spot but different classes -> class-aware NMS keeps
    # both, matching Ultralytics' default (a class-agnostic NMS would drop one).
    dets = _detections(
        [
            (320, 240, 100, 120, [0.9, 0.1, 0.05]),  # person
            (322, 241, 100, 120, [0.05, 0.1, 0.9]),  # car, overlaps the person box
        ]
    )["detections"]
    assert sorted(d["label"] for d in dets) == ["car", "person"]


def test_class_id_maps_to_label():
    # argmax over class scores is index 2 -> "car"
    dets = _detections([(120, 300, 40, 60, [0.05, 0.1, 0.85])])["detections"]
    assert len(dets) == 1
    assert dets[0]["label"] == "car"


def test_box_is_back_projected_to_original_pixels():
    # person box centered at (320,240) size 100x120 in the 640 letterbox.
    # top-left (270,180) -> undo pad(0,160) and scale 0.5 -> (540, 40, 200, 240).
    dets = _detections([(320, 240, 100, 120, [0.9, 0.1, 0.05])])["detections"]
    box = dets[0]["box"]
    assert abs(box["x"] - 540) < 1
    assert abs(box["y"] - 40) < 1
    assert abs(box["w"] - 200) < 1
    assert abs(box["h"] - 240) < 1


def test_full_scene_keeps_distinct_objects():
    # person (survives NMS), an overlapping person (dropped), a low-conf box
    # (thresholded), and a far-away car -> exactly person + car remain.
    dets = _detections(
        [
            (320, 240, 100, 120, [0.9, 0.1, 0.05]),  # person
            (323, 242, 100, 120, [0.8, 0.1, 0.05]),  # person, overlaps -> NMS drop
            (500, 400, 50, 50, [0.1, 0.1, 0.05]),  # low conf -> threshold drop
            (120, 300, 40, 60, [0.05, 0.1, 0.85]),  # car
        ]
    )["detections"]
    assert sorted(d["label"] for d in dets) == ["car", "person"]
