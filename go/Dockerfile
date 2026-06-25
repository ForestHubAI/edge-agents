# Multi-arch image for the ForestHub agent engine.
#
# Build natively on the host arch ($BUILDPLATFORM) and cross-compile via
# GOARCH so QEMU never has to emulate the Go toolchain — only the trivial
# COPY into the distroless layer is emulated.
#
# Build context must be the go/ directory (where go.mod lives):
#   docker build -t fh-engine:dev .
#   docker buildx build --platform linux/amd64,linux/arm64 -t fh-engine:dev .

FROM --platform=$BUILDPLATFORM golang:1.26 AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

ARG TARGETOS
ARG TARGETARCH
# No version is baked into the binary: the component version is the image tag,
# known to whoever deployed it (Ranger / the registry), not self-reported.
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -ldflags="-s -w" -o /engine ./cmd/engine

RUN mkdir -p /staging/workspace

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /engine /engine
# Pre-create the workspace mountpoint (component.Workspace), owned by the nonroot
# user so a bare `docker run` with no mount is still writable. A bind mount or named
# volume mounted here shadows this dir with the host source's ownership instead.
COPY --from=builder --chown=65532:65532 /staging/workspace /var/lib/foresthub/workspace
ENTRYPOINT ["/engine"]
