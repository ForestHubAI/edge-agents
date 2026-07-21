#!/usr/bin/env bash
# End-to-end smoke test: build the image, serve the example repository, and run a
# real object-detection request through it.
#
# Manual prerequisite: place a YOLOv8n export at examples/models/yolo/model.onnx
# (see examples/models/yolo/README.md). The test image is fetched if absent.
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
MODELS_DIR="$SERVICE_DIR/examples/models"
IMAGE="ml-inference:smoke"
CONTAINER="ml-inference-smoke"
PORT="8000"
BASE="http://localhost:$PORT"
TEST_IMAGE="$SERVICE_DIR/examples/bus.jpg"
TEST_IMAGE_URL="https://ultralytics.com/images/bus.jpg"

CONFIG_DIR="$(mktemp -d)"

fail() { echo "FAIL: $*" >&2; exit 1; }
rm_container() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
cleanup() { rm_container; rm -rf "$CONFIG_DIR"; }
trap cleanup EXIT

[ -f "$MODELS_DIR/yolo/model.onnx" ] || fail "missing $MODELS_DIR/yolo/model.onnx (see examples/models/yolo/README.md)"

echo "==> building $IMAGE"
docker build -t "$IMAGE" "$SERVICE_DIR"

# The boot config is authoritative — the component loads only the bundles it declares.
# The deploy renderer writes this file on a real device; stand in for it here.
echo '{"models":{"yolo":{}}}' > "$CONFIG_DIR/config.json"

echo "==> starting container"
rm_container
docker run -d --name "$CONTAINER" -p "$PORT:8082" \
  -v "$MODELS_DIR:/var/lib/foresthub/workspace:ro" \
  -v "$CONFIG_DIR/config.json:/etc/foresthub/config.json:ro" "$IMAGE" >/dev/null

echo "==> waiting for readiness"
for _ in $(seq 1 60); do
  if curl -fsS "$BASE/readyz" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[ "${ready:-}" = "1" ] || fail "service did not become ready (docker logs $CONTAINER)"

echo "==> /healthz"
curl -fsS "$BASE/healthz" >/dev/null || fail "/healthz not 200"

echo "==> /metadata lists the yolo model"
curl -fsS "$BASE/metadata" | python3 -c '
import json, sys
models = json.load(sys.stdin)["models"]
m = next((m for m in models if m["name"] == "yolo"), None)
assert m, "yolo not listed in /metadata"
assert m["handler"] == "builtin:yolo", m
' || fail "/metadata did not list yolo"

[ -f "$TEST_IMAGE" ] || { echo "==> fetching test image"; curl -fsSL "$TEST_IMAGE_URL" -o "$TEST_IMAGE"; }

echo "==> /infer model=yolo"
curl -fsS -X POST "$BASE/infer" -F "model=yolo" -F "binary=@$TEST_IMAGE" | python3 -c '
import json, sys
dets = json.load(sys.stdin)["result"]["detections"]
assert dets, "no detections returned"
top = max(dets, key=lambda d: d["score"])
print("   %d detection(s), top: %s @ %.2f" % (len(dets), top["label"], top["score"]))
' || fail "/infer returned no detections"

echo "PASS"
