# Example component: `grafana`

A local dashboard on the device — stock `grafana/grafana` brought in as a custom
`DeployComponent`, with **no image build**. Grafana is fully configured through
`GF_*` environment variables, so this is the **env-only** case: the whole
component is a `component.json` plus a `grafana.env.example`, nothing else.

It exercises:

- **`image`** — a stock upstream tag, no local build.
- **`pull`** — `"missing"`: pulled if not already present. It's the default, so it
  could be omitted here. (`"never"` would be for
  a locally built image; `"always"` re-pulls every start.)
- **a port** and **a volume** — `3000:3000`, dashboards persisted in a named volume.
- **`grafana.env.example`** — one secret (`GF_SECURITY_ADMIN_PASSWORD`, left empty
  for the operator to fill) and a few non-secret tunables with defaults.

No `config` blob, no `Dockerfile`, no wrapper entrypoint: an image that takes all
its settings from env needs none of that.

## Files

| File                  | Role                                                           |
| --------------------- | -------------------------------------------------------------- |
| `component.json`      | The `DeployComponent` merged into `DeploymentSpec.components`. |
| `grafana.env.example` | Env template the wizard reads to generate `grafana.env`.       |

## Using it

```bash
fh-workflow deploy <workflow.json> --component examples/components/grafana
```

The wizard merges grafana beside the engine, prompts for the empty admin password
(at a terminal), and writes `grafana.env` (mode 0600) into the bundle. Then follow
the bundle's own README to build/transfer/run.

See [`../README.md`](../README.md) for the full custom-component authoring guide.
