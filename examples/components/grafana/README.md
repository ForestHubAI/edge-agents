# Example component: `grafana`

A local dashboard on the device — stock `grafana/grafana` brought in as a
`DeployComponent`. Grafana's config is INI / `GF_*` env vars, **not JSON**, so
this is the **wrapped third-party** case: a thin entrypoint baked into the image
translates the spec's JSON `config` into Grafana's own env vars. It exercises:

- **`config`** — non-secret settings, frozen in the spec as a JSON object.
- **a wrapper entrypoint** — converts that JSON to `GF_*` env (the "how to
  interpret config" that lives in the image, not the spec).
- **a device-local secret** — the admin password, via `grafana.env`.
- **a port** and **a volume**.
- **a `HEALTHCHECK`** — in the `Dockerfile`, not the spec.

> A component whose app already reads JSON would skip all the wrapper machinery:
> stock image, read `/etc/foresthub/config.json` directly, done. Grafana needs the
> wrapper only because it doesn't speak JSON.

## Files

| File | Role |
| --- | --- |
| `component.json` | The `DeployComponent` that goes into `DeploymentSpec.components`. |
| `Dockerfile` | Builds the thin wrapper image (`foresthub/grafana:local`) and bakes in the healthcheck. |
| `entrypoint.sh` | Translates JSON `config` → `GF_*` env, then execs Grafana. |
| `grafana.env.example` | The device-local secret file. Copy to `grafana.env`, fill in, never commit. |

## Flow, end to end

1. **Build** (OSS, local): `docker build -t foresthub/grafana:local .` — `image`
   in `component.json` names this exact tag, run with `pull_policy: never`.
2. **Render**: the deployer writes `config` as JSON to `configPath` (omitted here,
   so the default `/etc/foresthub/config.json`) and bind-mounts it in.
3. **Start**: the wrapper reads that file, sets e.g. `GF_SERVER_HTTP_PORT=3000`,
   `GF_USERS_ALLOW_SIGN_UP=false`, then execs Grafana's `/run.sh`.
4. **Secrets**: compose injects `grafana.env` (`GF_SECURITY_ADMIN_PASSWORD`) as
   env vars. Grafana reads secret and non-secret `GF_*` the same way — they just
   come from opposite ends (spec-frozen config vs device-local env).

## The rendered service (roughly)

The renderer needs **no per-component knowledge** — only the generic fields:

```yaml
services:
  grafana:
    image: foresthub/grafana:local
    pull_policy: never                 # locally built
    restart: unless-stopped            # renderer convention
    ports:
      - "3000:3000"
    volumes:
      - grafana-storage:/var/lib/grafana
      - ./grafana-config.json:/etc/foresthub/config.json:ro   # from `config`
    env_file:
      - path: ./grafana.env            # device-local secrets; optional
        required: false
    labels:
      com.foresthub.config-hash: "<sha256 of config>"   # recreate trigger
```

(No `healthcheck:` here — it comes from the image's `HEALTHCHECK`.)

## Notes

- `configPath` is omitted, so config lands at the convention `/etc/foresthub/config.json`
  and the wrapper reads it there. A JSON-native third-party image that reads
  elsewhere would set `configPath` instead of being wrapped.
- The healthcheck command must exist *inside the image* — the wrapper image is
  busybox-based, so `wget` is available.
- `config` is secret-free by policy. The admin password is a secret and lives only
  in `grafana.env`.
