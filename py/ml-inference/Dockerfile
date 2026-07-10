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
    PIP_NO_CACHE_DIR=1 \
    ML_MODELS_DIR=/var/lib/foresthub/models

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app/ ./app/

# Run unprivileged; pre-create the mountpoint so a bare run still starts.
RUN useradd --system --uid 65532 fh-onnx \
    && mkdir -p ${ML_MODELS_DIR} \
    && chown fh-onnx ${ML_MODELS_DIR}
USER fh-onnx

EXPOSE 8000
ENTRYPOINT ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
