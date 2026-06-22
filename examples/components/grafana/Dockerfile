# Thin ForestHub wrapper around stock Grafana.
#
# Grafana's native config is INI / GF_* env vars, not JSON, so this image adds an
# entrypoint that translates the deployment spec's JSON `config` (mounted at
# /etc/foresthub/config.json) into Grafana's GF_* env vars before handing off to
# Grafana's own entrypoint.
#
# A component whose app already reads JSON config needs NO wrapper: it runs the
# stock image and reads /etc/foresthub/config.json directly. This wrapper exists
# only because Grafana doesn't speak JSON.
#
# Build (OSS, local): docker build -t foresthub/grafana:local .
FROM grafana/grafana:11.2.0

USER root
RUN apk add --no-cache jq
COPY entrypoint.sh /foresthub-entrypoint.sh
RUN chmod +x /foresthub-entrypoint.sh
USER grafana

# Health lives in the image, never in the deployment spec. The OSS compose path
# and the paid ranger both read this status from the runtime.
HEALTHCHECK --interval=10s --timeout=5s --retries=12 --start-period=30s \
  CMD wget -q --spider http://localhost:3000/api/health || exit 1

ENTRYPOINT ["/foresthub-entrypoint.sh"]
