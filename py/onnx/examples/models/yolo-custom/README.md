# yolo-custom example bundle (custom handler)

Same model as the `yolo` bundle, but driven by a **custom `file:handler.py`**
shipped in the bundle instead of `builtin:yolo`. It demonstrates the
operator-supplied-code path: the handler travels in the mounted bundle, so adding
or changing it needs **no image rebuild**.

`handler.py` here subclasses the built-in YOLO handler and adds `count` + `summary`
to the result, so you can see your own code ran.

To try it, drop in the same weights as the `yolo` bundle (not committed):

```bash
cp examples/models/yolo/model.onnx examples/models/yolo-custom/model.onnx
```

Then run the container with `examples/models` mounted (both bundles load) and call
`POST /infer` with `model=yolo-custom` — the result carries the extra `count` +
`summary` fields. See the repo's `docs/handlers.md` (Recipe B) for the full
custom-handler workflow.
