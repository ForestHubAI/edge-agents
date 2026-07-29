# ForestHub llama component — one container, many models.
#
# llama.cpp's llama server hosts a single model per process, so we front it with
# llama-swap: a proxy presenting one OpenAI-compatible endpoint (:8080) that starts and
# idle-evicts a llama server per model on demand. The stock llama-swap image already
# BUNDLES both binaries, so this image adds only jq + a thin entrypoint that renders
# llama-swap's YAML from the ForestHub boot config. No from-scratch build, no Go.
#
# Build (multi-arch), from this folder as context:
#   docker buildx build --platform linux/amd64,linux/arm64 \
#     -t ghcr.io/foresthubai/llama:1.0.0 --push .
# In CI this is done by .github/workflows/release-llama.yml.
#
# The base is pinned by digest — ':cpu' is a moving tag, and a rebuild must not silently
# pick up a different llama-swap. This is the multi-arch index (linux/amd64 + linux/arm64),
# so buildx still resolves per platform. Swap the base for ':cuda' / ':vulkan' to match the
# device's accelerator, and re-pin its digest.
FROM ghcr.io/mostlygeek/llama-swap:cpu@sha256:eb82e52f7dbde846ee9e36518b13e10a176c0380d464ee06442e4139e709fead

# jq drives the JSON -> YAML config bridge in the entrypoint. The llama-swap images are
# Debian-based; adjust this stanza if you retarget the base.
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq \
    && rm -rf /var/lib/apt/lists/*

COPY entrypoint.sh /usr/local/bin/llama-entrypoint
RUN chmod +x /usr/local/bin/llama-entrypoint \
    && mkdir -p /var/lib/foresthub/workspace

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/llama-entrypoint"]
