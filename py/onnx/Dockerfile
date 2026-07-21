# fh-onnx — generic ONNX inference component (model repository).
#
# Debian-slim base (a musl base would break the manylinux-only ML wheels).
# Multi-arch: docker buildx --platform linux/amd64,linux/arm64.
FROM python:3.13-slim

# Shared libs the ML wheels link at runtime: OpenMP (onnxruntime), glib (opencv).
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgomp1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/

# The models repository mounts at the component's workspace path
# (contract/component-constants.json → paths.workspace, == config.py WORKSPACE_DIR).
# A contract constant, not configuration: there is no env override to set.
# Run unprivileged; pre-create the mountpoint so a bare run without a volume still starts.
RUN useradd --system --uid 65532 fh-onnx \
    && mkdir -p /var/lib/foresthub/workspace \
    && chown fh-onnx /var/lib/foresthub/workspace
USER fh-onnx

# Port must equal component-constants.json components.mlInference.port (drift-guarded
# by tests/test_constants.py) — the on-device resolver builds http://onnx:<port>.
EXPOSE 8082
ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8082"]
