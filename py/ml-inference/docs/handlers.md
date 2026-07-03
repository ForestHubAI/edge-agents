# Handlers

A handler turns a model's raw input into an ONNX Runtime feed and the model's raw
output into the structured `result` the service returns. It is the **one seam** that
keeps a single generic image serving any model family — `main.py` knows nothing
model-specific (see [architecture.md](./architecture.md)). This doc covers the
interface, the two built-ins, and how to add your own.

## The interface (`base.py`)

```python
class Handler(ABC):
    def load(self, session, manifest, bundle_dir) -> None: ...   # one-time setup; default no-op
    def preprocess(self, binary, tensors, params) -> tuple[Feed, Any]: ...   # → (feed, context)
    def infer(self, session, feed, context, params) -> list: ...  # run the model; default 1 pass
    def postprocess(self, outputs, context, params) -> dict: ...             # → result object
```

- **`load`** runs once per model at startup, with the open ONNX session, the parsed
  manifest and the bundle directory. Cache here what preprocessing needs — input
  name/shape, labels, dtypes. Default is a no-op.
- **`preprocess`** builds the ORT `feed` (`{input_name: ndarray}`) from the request's
  `binary` and/or `tensors`. It returns `(feed, context)`; `context` is handler-private
  state handed to `postprocess` (e.g. the image geometry needed to map results back).
- **`infer`** runs the model on the `feed` and returns the raw outputs. The default is
  a single `session.run` — the right seam for one-graph models. Override it to own the
  run loop: a multi-session pipeline (a separate encoder/decoder graph opened in
  `load`) or an autoregressive model that calls the session repeatedly. `main.py` is
  unchanged either way.
- **`postprocess`** turns the raw ORT `outputs` into the structured `result` dict.
- **`params`** is the manifest params merged with the request params (request wins),
  so per-request overrides (thresholds, …) reach both methods.

Input is generic: a model uses `binary` (e.g. an image), `tensors` (named numeric
arrays), or both — whichever its handler expects. Raise `ValueError` for bad input;
`main.py` maps it to HTTP 422.

## Resolution (`registry.py`)

A manifest's `handler` field names which handler drives the model:

- **`builtin:<name>`** — a handler shipped in this package, looked up in
  `BUILTIN_HANDLERS`. Classes register themselves with the `@register_builtin("<name>")`
  decorator. The registration runs **on import**, so `app/handlers/__init__.py` imports
  every built-in module (`from . import raw, yolo`) — a new built-in must be added
  there or its name won't resolve.
- **`file:<relative.py>`** — a Python file inside the bundle, loaded dynamically at
  startup (`_load_file_handler`): the module is imported and its first `Handler`
  subclass is instantiated. This is **operator-trusted** code (see Recipe B).

Unknown built-in name, missing file, or no `Handler` subclass → `HandlerError`, which
aborts startup.

## Built-in: `yolo` (object detection)

`yolo.py`. For single-stage YOLO-family models (v8/v9/v11) exported to ONNX
**without** embedded NMS.

- **`load`** resolves the input size (from `params.input` or the model's declared input
  shape) and loads the label list (`params.labels`, a file in the bundle).
- **`preprocess`** decodes the image, letterboxes it to the input size (aspect-preserving,
  gray `114` padding), BGR→RGB, scales to `[0, 1]`, transposes HWC→CHW, adds the batch
  dim. `context` is a `_LetterboxCtx` (scale + padding + original size).
- **`postprocess`** reads the raw `(1, 4+classes, anchors)` output, filters by
  `confThreshold`, runs NMS (`cv2.dnn.NMSBoxes` at `nmsThreshold`), maps class id →
  label, and back-projects each box through the letterbox into original-image pixels.
- **Result:** `{ "detections": [ { label, score, box: { x, y, w, h } } ] }`.

The two thresholds default to `0.25` / `0.45` and are overridable via `params`.

## Built-in: `raw` (tensor passthrough)

`raw.py`. For models that need no pre/post-processing — classical ML
(skl2onnx), time-series, embeddings. The request supplies the input tensors by name;
they go straight in, every output comes straight back.

- **`load`** caches the model's input dtypes and output names.
- **`preprocess`** casts each named tensor in `tensors` to the model's declared dtype
  (so Python ints/floats don't get fed as `int64`/`float64` and rejected by ORT) and
  feeds them by name. Missing `tensors`, or an unknown tensor name → `ValueError`.
- **`postprocess`** maps each output array to its name.
- **Result:** `{ "outputs": { <output-name>: <nested array> } }`.

## Recipe A — add a built-in handler

For a task that ships with the image (no per-bundle code).

1. Create `app/handlers/<name>.py` with a `Handler` subclass decorated
   `@register_builtin("<name>")` and implement `load`/`preprocess`/`postprocess`.
2. Register it on import: add `from . import <name>` to `app/handlers/__init__.py`
   (alongside `raw`, `yolo`).
3. Add a unit test `tests/test_<name>.py` — weights-free: build a synthetic output
   tensor (and/or a fake session for `load`), assert the `result` shape and the
   tricky math. No ONNX model, no Docker (so it runs in CI). Mirror `tests/test_yolo.py`
   / `tests/test_raw.py`.
4. A bundle then selects it with `handler: builtin:<name>` in its `manifest.yaml`.

If the new result shape should be a first-class part of the wire, extend
`contract/mlinference.yaml` and regenerate — but `result` is a free-form object, so a
new shape needs no contract change to work.

## Recipe B — a custom `file:handler.py` (operator-trusted)

For a one-off model whose pre/post-processing doesn't warrant a built-in.

1. In the bundle, add a `handler.py` defining a `Handler` subclass (import it from the
   installed `app.handlers.base`).
2. Point the manifest at it: `handler: file:handler.py`.
3. It may use anything in the image's frozen stack (numpy, opencv, scipy, scikit-learn),
   and may build on a built-in (e.g. `import app.handlers.yolo` and subclass it).

> **Loader tip.** Resolution instantiates the *first* `Handler` subclass found in the
> file. If you reuse a built-in, import it as a **module** (`import app.handlers.yolo as
> y`, then subclass `y.YoloHandler`) rather than `from … import YoloHandler` — otherwise
> the imported class becomes a candidate and may be picked instead of yours.

A runnable example lives in `examples/models/yolo-custom/`: it subclasses the built-in
YOLO handler and annotates the result with `count` + `summary`. Because the handler
ships in the mounted bundle, adding or changing it needs **no image rebuild** — just
restart the container so the repository is rescanned.

> **Trust.** A `file:` handler is arbitrary Python executed with the container's
> privileges, loaded at startup. It carries the same trust level as the mounted model
> weights and the compose file — only mount bundles from sources you trust. Sandboxing
> is a later hardening concern; built-ins need no such trust.

## File map

| Concern | File |
| --- | --- |
| Handler interface (`load`/`preprocess`/`postprocess`, `Feed`) | `app/handlers/base.py` |
| Resolution + `BUILTIN_HANDLERS` + `@register_builtin` | `app/handlers/registry.py` |
| Built-in registration on import | `app/handlers/__init__.py` |
| Built-in handlers | `app/handlers/yolo.py`, `app/handlers/raw.py` |
| Handler tests (one per handler) | `tests/test_yolo.py`, `tests/test_raw.py` |
