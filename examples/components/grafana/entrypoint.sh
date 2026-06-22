#!/bin/sh
# Thin wrapper entrypoint: the "how to start / how to interpret config" that lives
# in the IMAGE, never in the deployment spec.
#
# It reads the spec's JSON config (rendered by the deployer to configPath) and
# translates { "section": { "key": value } } into Grafana's own GF_SECTION_KEY
# environment variables, then execs Grafana's stock entrypoint. Secrets (e.g.
# GF_SECURITY_ADMIN_PASSWORD) are NOT here -- they arrive as env vars from the
# device-local grafana.env via compose, and Grafana reads them the same way.
set -e

cfg="${FH_CONFIG_FILE:-/etc/foresthub/config.json}"
if [ -f "$cfg" ]; then
  eval "$(jq -r '
    to_entries[] as $section
    | $section.value | to_entries[]
    | "export GF_\($section.key | ascii_upcase)_\(.key | ascii_upcase)=\(.value | tostring | @sh)"
  ' "$cfg")"
fi

exec /run.sh "$@"
