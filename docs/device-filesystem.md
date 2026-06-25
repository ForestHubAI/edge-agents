# Device Filesystem Contract — Component Directories

> Status: **decided direction; partially implemented.** The cross-repo,
> cross-language contract for how a ForestHub device lays out per-component state on
> disk.
>
> - **Implemented:** the in-container mountpoints (§4) — pinned as constants in
>   `go/component/paths.go` (Go) and `ts/workflow-core/src/deploy/spec.ts` (TS); the
>   engine reads/writes them.
> - **Not yet:** the host-side layout (§2–§3), per-container provisioning &
>   ownership (§5), and artifact pull (§6). The OSS renderer still emits a Docker
>   named volume + `./models` instead of the root-relative layout (see §10, §12).
>
> Honored by the **renderers** — whichever one stands up a device renders the host
> layout and mounts it into containers: **Ranger** (hosted control plane,
> `fh-backend/internal/ranger`) and the **OSS TypeScript renderer** (`spec.ts`,
> emitted by `fh-workflow`) — and by the **engine / edge-agents components**
> (read/write their mounted paths, never the host layout). This file is the source
> of truth; if a renderer and a component disagree, they disagree with this file.
>
> Supersedes the backend-authoritative memory model (`agent_memory_files` in
> Postgres, synced over `/agents/memory`). See [§11](#11-what-this-supersedes).

## TL;DR

Durable component state lives **on the device, authoritatively** — not in the
backend. Each component gets three standard directories keyed by its **stable
container name**:

| Directory | Owner | Lifecycle | Holds |
| --- | --- | --- | --- |
| `…/deploy/<container>/` | The renderer | **Overwritten every deploy** | Rendered config, env, **resolved secrets** |
| `…/workspaces/<container>/` | The component + the user | **Persists across deployments** | Durable working data: engine memory files, llama model weights, broker durable state |
| `…/logs/<container>/<deployment_id>/` | The component's logger | **One subdir per deployment, rotated; retained until evicted** | Append-only structured logs (Ranger-managed; OSS logs to stdout) |

The backend is **observational and never on the device's write path**. The device
populates its own workspaces — by **seed** (small declared files) or **pull** (large
artifacts, device-initiated) — so it is fully operational behind NAT and offline,
which is also the only model consistent with the OSS standalone path (no backend).

---

## 1. Identity = the container name

The persistence binding is the **workspace directory**, keyed by the component's
**container name**. "Same container name ⇒ same workspace ⇒ same durable state."
That is the entire identity model — there is no separate agent/slot record that owns
memory.

This places one hard constraint on the deployment spec and the renderers:

> **Container names MUST be deterministic from the spec and stable across
> deployments.** A name that churns between deploys orphans the old workspace (its
> data is stranded, not deleted) and starts the component on an empty one.

- `engine` → the engine's memory workspace.
- `llama-<modelKey>` → that model's weights. Two models on one device ⇒ two distinct,
  stable names ⇒ two workspaces. The name must encode enough to keep the right files.
- `broker` → the broker's durable state.

Because the model key is in the container name, swapping a workflow's model changes
the name → a fresh workspace, so a workspace never holds the *wrong* model. Renaming
a component is therefore a destructive-looking operation (it abandons the old
workspace) — which is also the seam used for "reset this component's state" and for
device-to-device transfer (copy the workspace dir).

## 2. The device layout — one root-relative convention

The layout is a single tree with a **renderer-chosen root**. The structure under the
root is identical everywhere; only the root differs — **no named volumes**:

| Renderer | `root` | Resolves to |
| --- | --- | --- |
| **Ranger** | `/var/lib/foresthub` (absolute) | a device-authoritative, stable system path |
| **OSS** (`fh-workflow`) | `.` (the bundle dir) | Docker resolves it relative to the compose file → portable, no sudo |

```
<root>/
  deploy/<container>/            # rewritten every deploy: config.json, <container>.env, resolved secrets
  workspaces/<container>/        # durable, rw by the container: memory, model weights, broker state
```

State (`deploy/`, `workspaces/`) shares one root. **Logs use a separate root** —
`/var/log/foresthub/<container>/<deployment_id>/` on Ranger (the FHS puts logs under
`/var/log`); the OSS bundle logs to stdout and writes no log files (§9), so its log
root never matters.

- The **in-container** paths are fixed constants (§4) and never see the root — the
  root only sets the *host side* of each bind mount. So the component contract is
  identical no matter where the root resolves.
- **Why a configurable root, not one absolute path.** Ranger is a permanent device
  agent that owns the host, so an absolute `/var/lib/foresthub` is right — stable
  across redeploys, the canonical place to inspect and back up. The OSS bundle is
  generated on one machine and `scp`'d to another; a relative root (`.`) keeps it
  drop-anywhere — no sudo, no pre-created system dirs. Same structure, different root.
- Follows the FHS on Ranger: `/var/lib` for persistent state, `/var/log` for logs;
  `deploy/` is machine-generated, so it lives under `/var/lib`, **not** `/etc` (which
  is for admin-edited config). Namespaced under `foresthub/` so nothing collides with
  other host files.
- Replaces the old flat `RANGER_BUNDLE_DIR` (`/var/lib/foresthub/deployment`) with the
  per-component, two-category state layout (+ logs).

> **Stable-root convention (OSS).** With `root = .`, the workspace lives *in* the
> bundle dir — redeploy into the **same** dir or the workspace orphans. This already
> holds today (the named volume is keyed by `COMPOSE_PROJECT_NAME` = the dir name);
> root-relative just makes the durable data **visible** (`./workspaces/`) and
> inspectable instead of hidden inside a Docker volume.

## 3. Where that filesystem physically lives (per host)

The layout above is the *same* on every host. What differs is only **where this Linux
filesystem physically sits** — because a Linux container needs Linux filesystem
semantics (rw by a nonroot uid, working `chown`), and those are only real where the
Linux FS *is* the host FS.

| Host | Production? | Where `/var/lib/foresthub` lives | Reach it from the host |
| --- | --- | --- | --- |
| **Linux device** (Pi/SBC) | ✅ primary | the device's own root filesystem | the paths directly |
| **Windows** | ✅ (LLM agents only, no driver I/O) | inside the **WSL2** distro's ext4 that backs Docker — a real Linux FS | `\\wsl$\<distro>\var\lib\foresthub\…` in Explorer |
| **macOS** | ❌ dev only | Docker Desktop's Linux VM | bind a Mac folder (virtiofs, **emulated** perms) or a named volume; not first-class |

- **Windows is WSL2-rooted on purpose.** Bind-mounting a native Windows folder
  (`%ProgramData%\ForestHub\…`) into the Linux container gives *emulated* ownership
  (`chown` is a no-op), a slow file bridge, and Docker-Desktop-version-dependent
  behaviour. Rooting inside WSL2 gives true Linux semantics and keeps the single
  `/var/lib/foresthub/…` convention; users still reach the files from Windows via
  `\\wsl$`.
- **macOS has no clean equivalent** — its Docker VM is opaque (no `\\wsl$`), so there
  is no "real Linux perms *and* host-visible" option. Since Mac is dev-only, the
  emulated-perms bind mount (or a named volume) is acceptable there and nowhere else.

## 4. In-container mountpoints (the component contract — implemented)

This is what the engine and other components actually code against. It is
**OS-independent and stable.** The renderer bind-mounts each host directory to its
canonical in-container path:

| Host dir | Container mount | Mode | Consumed via |
| --- | --- | --- | --- |
| `deploy/<container>/config.json` | `/etc/foresthub/config.json` | ro | `component.ConfigFile` |
| `deploy/<container>/<container>.env` | (env_file) | — | process env |
| `workspaces/<container>/` | `/var/lib/foresthub/workspace/` | rw | `component.Workspace` |
| `logs/<container>/<deployment_id>/` | `/var/log/foresthub/` | rw | logger file sink (§9) |

- The two non-log mounts are **fixed contract constants, not env-tunable**: their
  values ARE the renderers' mount targets, so the renderer wires no env var to
  relocate them (Go: `go/component/paths.go`; TS: `spec.ts`). Changing one means
  changing every renderer's mount in lockstep, or the component reads an unmounted,
  empty path.
- The engine reads/writes its memory under `/var/lib/foresthub/workspace` — local
  file I/O, **no network call, no credential.** This is what dissolves the
  memory-access auth question: there is no `/agents/memory` endpoint to authenticate
  against.
- For logs, the component always writes the **same in-container path**
  (`/var/log/foresthub/`); the renderer repoints that mount at a fresh host
  `logs/<container>/<deployment_id>/` each deploy, so the component is
  **deployment-agnostic** — it never knows or sets the deployment id (§9).
- A component may declare *additional* mounts in its spec
  (`DeployComponent.volumes`); the three standard ones are provisioned by the
  renderer from the container name, with no per-spec declaration.

## 5. Provisioning & ownership (the renderer's job)

Because the standard mounts are **bind mounts to host dirs** (not named volumes),
ownership is explicit — there is no Docker auto-chown-on-first-use to lean on. For
each container the renderer must, before starting it:

1. **Create the dirs** — `mkdir -p` the `deploy/` and `workspaces/` dirs (and the
   per-deployment `logs/` dir where applicable).
2. **Make the workspace writable by the container's runtime uid.** The engine image
   is **distroless nonroot (uid 65532)**, so its `workspaces/<container>/` must be
   owned/writable by 65532. Two ways:
   - `chown -R 65532:65532 …/workspaces/<container>` (preferred — keeps the container
     nonroot), or
   - run the container as root (`user: "0:0"`) and skip the chown (simpler; drops the
     nonroot hardening).

   Read-only mounts (the config file; a llama model the sidecar only *reads*) need no
   chown.

Ownership is **orthogonal to the root** (§2): any bind mount, relative or absolute,
loses the named-volume auto-chown. It is automatic on **Ranger** (a root-privileged
device agent that owns the host — it creates and chowns the dirs as it reconciles).
The **OSS** bundle defaults to **running the engine as root** (`user: "0:0"`, simplest
for a standalone controller) and documents `chown 65532` as the hardened alternative
(§10).

## 6. Populating the workspace — seed + pull, always device-initiated

The device is authoritative; **the backend never writes the device.** Every byte that
lands in a workspace gets there by a **device-initiated** action — which is precisely
what makes the model work behind NAT (devices can open *outbound* connections; nothing
needs to reach *in*) and keeps Ranger's "just declare a deployment and it runs"
promise intact even for large models.

There are two mechanisms, split by size:

- **Seed (inline, create-if-absent).** Small declared content — a workflow's memory
  files, e.g. `notes.md` with starter text — ships *in* the deployment spec. The
  renderer writes it into the workspace **create-if-absent**: never clobber an
  existing file, which holds accumulated content. (Moves the backend's old
  `seedMemory` to the renderer as a conditional file write.) The uid-churn problem
  the old `Seed` solved disappears on the device: workspace files are keyed by **name**
  (`notes.md`), not a builder uuid, so there is nothing to re-key.

- **Pull (by reference, device-initiated outbound).** Large artifacts — model weights
  — are **not** in the spec (too big). The spec carries a **reference**: a registry/
  object-store coordinate **+ checksum**. Ranger fetches it **outbound** into the
  workspace, **fetch-if-absent**, and verifies the checksum before starting the
  sidecar — exactly how it already pulls container images. **Workspace persistence is
  the cache** that makes this economical: a multi-GB model is pulled once and reused
  across redeploys, instead of re-downloaded each time.

**Manual side-load stays valid** for air-gapped devices and the OSS standalone path
(no backend to declare a coordinate): drop the file into the host
`workspaces/<container>/` dir and the container picks it up. The **host-visible**
workspace makes this a feature, not a workaround — and is also why the workspace must
be a known absolute path, not an opaque named volume.

> The BE pushing into a workspace is the **wrong** model — not (only) because of NAT,
> but on principle (§7): it would re-introduce the backend-authoritative state this
> doc deletes. Population is device-initiated, full stop.

## 7. Device-authoritative, backend-observational

- **Runtime writes never leave the device.** Memory, model files, durable broker
  state are written and read locally. The backend is not consulted at boot or on
  write.
- **The backend may observe.** For FE inspection and opt-in backup, the device may
  **push** workspace/log snapshots to the backend (Device-Key authenticated). This
  channel is **eventually-consistent, best-effort** — never authoritative, never
  required for the component to run.
- **Backup is a paid follow-up, not optional comfort.** Device disks fail (SD cards
  especially). With memory no longer in Postgres, durability is the device's — back it
  up (periodic workspace snapshot → backend/object store) or accept loss on disk
  death. State this in the paid tier explicitly.
- **Transfer = backup → restore.** Moving a component's identity to another device is
  a copy of its workspace directory (device → backend → new device), not a pointer
  re-point. The deliberate cost of device-authoritative state.

## 8. Secrets do NOT go in the workspace

Resolved secrets (MQTT passwords, broker credentials, model-endpoint keys) are
**resolved fresh every deploy** and must not persist in a directory that survives
deployments — that would leave plaintext credentials at rest indefinitely and break
rotation-without-redeploy.

- Resolved secrets → **`deploy/<container>/`** (overwritten every deploy) or injected
  env.
- Durable user/agent data (models, memory) → **`workspaces/<container>/`**.

Do not put a "credentials file" in the broker's workspace. The broker's *durable
state* (if any) may live there; its *credentials* are deploy-dir, refreshed each
deploy.

## 9. Logs

Logs are a **third category** — neither overwritten config nor user-managed workspace
data — and follow the same device-authoritative, backend-observational shape. This
section describes the **Ranger** end state; the **OSS** bundle logs to stdout
(`docker compose logs`) and does **not** create per-deployment log dirs (no shipper,
no deployment-id lifecycle — §10).

- **Persist across deployments.** Logs must survive a redeploy, or you lose the record
  of the boot that just failed. So logs live in `logs/`, not the overwritten `deploy/`.
- **Partitioned by deployment — the path is the tag.** One subdir per deployment:
  `logs/<container>/<deployment_id>/`. The two dimensions every fleet query needs —
  **component** and **deployment** — are the `<container>` and `<deployment_id>` path
  segments, not fields the producer sets. Ranger owns the layout, so it derives both
  **structurally** when it ships; a component cannot forget, omit, or fake its tags.
  This also tags **non-SDK containers** (anything Ranger can `docker logs`).
  - Restarts/crash-loops *within* one deployment share that deployment's subdir
    (correct grain). Rotation happens inside it.
  - "Everything from deploy N" = `logs/*/<deployment_id>/`; "this component's history"
    = `logs/<container>/` — both cheap globs.
- **Components are credential-free; Ranger is the sole shipper.** Each component's
  logger has **console + rotated-file sinks only** — no network, no backend URL, no
  Device-Key. Ranger tails the files, stamps `component`/`deployment_id` from the path,
  batches, and best-effort POSTs to the backend's device-log plane. Only Ranger holds
  the credential and touches the network (the Greengrass nucleus/LogManager split).
  - *Interim:* until the file-tailing shipper lands, the engine keeps its existing
    direct-push HTTP sink, and Ranger ships only its own lines. The end state retires
    both.
- **The logger is shared, not engine-specific.** Engine and Ranger configure the same
  package (`go/logging` — `Configure(level, writers…)` fanning console + a rotating
  file writer). Ranger replaces stdlib `log` with it, so Ranger's own reconcile
  failures land in `logs/ranger/<deployment_id>/`.
- **Two-layer retention:**
  - *Device (Ranger), disk-budget.* `logs/` has a total-size cap; over budget, Ranger
    evicts whole `logs/<container>/<deployment_id>/` dirs **oldest-first,
    already-shipped-first**. The on-device file is a **bounded** buffer — a long
    backend outage on a small disk *will* drop the oldest unshipped logs, by design.
  - *Backend, time-based.* The backend log store ages rows out on its own schedule.

See the backend's `docs/logging-overhaul.md` for the ingest wire, the `device_logs`
schema, and the backend retention job.

## 10. The two renderers

Both honor §2–§6 identically — same root-relative layout, same in-container paths,
same seed/pull model. They differ only in the **root** (§2) and in capabilities the
OSS one-shot bundle lacks:

| Concern | Ranger (hosted, on-device agent) | OSS renderer (`fh-workflow`) |
| --- | --- | --- |
| `root` (§2) | `/var/lib/foresthub` (absolute) | `.` (bundle dir, portable) |
| Provision + own dirs (§5) | automatic (root agent: `mkdir` + `chown 65532`) | run engine as root by default; `chown 65532` to harden |
| Model artifacts (§6) | **pull** by coordinate + checksum, device-initiated | bundled / manually side-loaded (no backend coordinate) |
| Seeding (§6) | create-if-absent write at reconcile | create-if-absent write into the bundle's workspace dir |
| Logs (§9) | per-deployment dirs + shipper + retention | stdout (`docker compose logs`); no per-deployment dirs |
| Credential | holds the device-log credential | none |

**OSS migration (not yet done — §12):** today `spec.ts` emits a Docker named volume
(`engine-memory`) and mounts llama models from `./models`. Both move onto the
root-relative `<root>/workspaces/<container>/` bind-mount layout with `root = .`:
engine memory → `./workspaces/engine/`, a model → `./workspaces/llama-<key>/` (the
sidecar reads it at the in-container `/var/lib/foresthub/workspace`). The engine
defaults to `user: "0:0"` so the bind mount is writable without a chown step.

## 11. What this supersedes

The backend-authoritative memory model is removed:

- **Deleted (fh-backend):** `agent_memory_files` table, `internal/database/memory.go`,
  the memory service, the `GET/PUT /agents/memory` endpoints. `seedMemory` becomes a
  renderer-side create-if-absent write (§6).
- **Auth simplification:** with no runtime memory channel, the engine needs **no
  backend credential for memory**. `agent_secret` as a stored identity loses its
  primary justification; in the end state only Ranger holds a credential.
- **Identity simplification:** the durable-state owner is the workspace directory keyed
  by container name, not an `agents`/slot row. Any remaining `agents` row is slim
  bookkeeping (e.g. MQTT identity), not the owner of durable data.

## 12. Open questions

- **Model-artifact delivery (the big one).** Specify: the spec field carrying a model
  **reference** (registry/object-store coordinate + checksum, **never the bytes**); the
  artifact store the device pulls from (own object store, or pass-through to a public
  registry); and Ranger's fetch-if-absent + checksum-verify into the workspace. This is
  what makes the §6 "pull" path real and keeps Ranger zero-touch for large models.
- **Container-name stability across spec edits.** A deterministic naming function in
  the shared packaging library so a workflow edit that doesn't change a component still
  yields the same container name (and keeps its workspace). The lynchpin — specify it
  before implementing.
- **Windows/WSL2 provisioning.** Which WSL2 distro hosts the layout, how Ranger
  provisions + chowns inside it, and the `\\wsl$` UX for users dropping model files.
- **Workspace GC / "reset" UX.** Orphaned workspaces (renamed/removed components) are
  the user's to clean. Surface them; make "reset" an explicit, snapshot-taking action.
- **Log disk-budget tuning** — the total-size cap and rotation thresholds (§9). Policy
  decided (oldest-first, shipped-first); the numbers are not.
- **Multi-component-per-name** is forbidden by construction (name is the key); confirm
  the renderer enforces uniqueness within a device.

> **Decided since first draft:** in-container paths are fixed constants, implemented in
> `go/component/paths.go` + `spec.ts` (§4). The host layout is **root-relative** — one
> structure under a renderer-chosen root (Ranger `/var/lib/foresthub`, OSS the bundle
> dir `.`); no named volumes (§2). OSS runs the engine as root so the bind mount is
> writable; Ranger chowns to 65532 (§5). **Windows is WSL2-rooted**; macOS is dev-only
> (§3). Workspace population is **device-initiated**:
> inline **seed** for small declared files, outbound **pull-by-reference** for large
> artifacts; the **BE never writes the device** (§6). Logs are *partitioned* by
> deployment (structural `component`/`deployment_id`), shipped tail-from-file by Ranger
> as sole shipper; the logger is the top-level `go/logging` (§9).
