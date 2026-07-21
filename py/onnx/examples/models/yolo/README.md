# yolo example bundle

A ready-to-run object-detection bundle — except the model weights, which are not
committed. Drop a YOLOv8n ONNX export here as `model.onnx`:

```bash
pip install ultralytics
yolo export model=yolov8n.pt format=onnx imgsz=640
mv yolov8n.onnx model.onnx
```

Export **without** `nms=True`: the `builtin:yolo` handler runs NMS itself (with the
thresholds set in the bundle's manifest `params`), and expects the model's raw
detection output.

The folder name (`yolo`) is the model id — the `model` in the inference path,
`POST /models/yolo/infer/binary`. Add more models by adding sibling folders under
`examples/models/`.
