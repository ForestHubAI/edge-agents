# Device Filesystem Contract — Component Directories

> Status: **decided direction**, not yet implemented. The cross-repo contract for
> how a ForestHub device lays out per-component state on disk. Honored by **Ranger**
> (renders the layout, mounts it into containers — `fh-backend/internal/ranger`) and
> by the **engine / edge-agents** components (read/write their mounted paths, never
> the host layout). This is the source of truth for the device layout; if Ranger and
> the engine disagree, they disagree with this file.
>
> Supersedes the backend-authoritative memory model (`agent_memory_files` in
> Postgres, synced over `/agents/memory`). See [§8](#8-what-this-supersedes).

## TL;DR

Durable component state lives **on the device, authoritatively** — not in the
backend. Each component gets three standard directories keyed by its **stable
container name**:

| Directory | Owner | Lifecycle | Holds |
| --- | --- | --- | --- |
| `…/deploy/<container>/` | Ranger / control plane | **Overwritten every pull** | Rendered config, env, **resolved secrets** |
| `…/workspaces/<container>/` | The component + the user | **Persists across deployments** | Durable working data: engine memory files, llama model files, broker durable state |
| `…/logs/<container>/<deployment_id>/` | The component's logger | **One subdir per deployment, rotated; old deploys retained until evicted** | Append-only structured logs; `<container>`/`<deployment_id>` in the path *are* the component + deployment tags |

The backend is **observational**: it may pull snapshots of workspaces/logs for the
FE and offer opt-in backup, but it is never the source of truth and is never on the
runtime write path. This makes a device fully operational offline, and is the only
model consistent with the OSS standalone path (no backend at all).

---

## 1. Identity = the container name

The persistence binding is the **workspace directory**, and the workspace is keyed by
the component's **container name**. "Same container name ⇒ same workspace ⇒ same
durable state." That is the entire identity model — there is no separate agent/slot
record that owns memory.

This places one hard constraint on the deployment spec and the renderers:

> **Container names MUST be deterministic from the spec and stable across
> deployments.** A name that churns between deploys orphans the old workspace (its
> data is stranded, not deleted) and starts the component on an empty one.

- `engine` → the engine's memory workspace.
- `llama-<modelKey>` → that model's files. Two models on one device ⇒ two distinct,
  stable names ⇒ two workspaces. The name must encode enough to keep the right files.
- `broker` → the broker's durable state.

Renaming a component (changing its container name) is therefore a destructive-looking
operation: it abandons the old workspace. That is also the seam used for "reset this
component's state" and for device-to-device transfer (copy the workspace dir).

## 2. Host paths (per OS)

The OS prefix follows each platform's convention for persistent service state; the
`foresthub/<category>/<container>` structure underneath is identical everywhere.

| | Linux | Windows | macOS (Docker Desktop) |
| --- | --- | --- | --- |
| Prefix | `/var/lib/foresthub` | `%ProgramData%\ForestHub` | `/usr/local/var/foresthub` |
| Deploy | `/var/lib/foresthub/deploy/<container>/` | `…\ForestHub\deploy\<container>\` | `…/foresthub/deploy/<container>/` |
| Workspace | `/var/lib/foresthub/workspaces/<container>/` | `…\ForestHub\workspaces\<container>\` | `…/foresthub/workspaces/<container>/` |
| Logs | `/var/log/foresthub/<container>/<deployment_id>/` | `…\ForestHub\logs\<container>\<deployment_id>\` | `/usr/local/var/log/foresthub/<container>/<deployment_id>/` |

Notes:
- Linux follows the FHS: `/var/lib` for state that persists between runs, `/var/log`
  for logs. The deploy dir is machine-generated (regenerated every pull), so it lives
  under `/var/lib`, **not** `/etc` (which is for admin-edited config).
- These are **host paths and Ranger's concern only.** No component should hardcode
  them — components see the in-container paths in §3.
- This replaces the current flat `RANGER_BUNDLE_DIR` (`/var/lib/foresthub/deployment`,
  `%ProgramData%\ForestHub\deployment`) with the per-component, three-category layout.

## 3. In-container mountpoints (the edge-agents contract)

This is what the engine and other edge-agents components actually code against. It is
**OS-independent and stable.** Ranger bind-mounts each host directory to its canonical
in-container path:

| Host dir | Container mount | Mode | Consumed via |
| --- | --- | --- | --- |
| `deploy/<container>/config.json` | `/etc/foresthub/config.json` | ro | `ENGINE_CONFIG_FILE` |
| `deploy/<container>/<container>.env` | (env_file) | — | process env |
| `workspaces/<container>/` | `/workspace/` | rw | `ENGINE_MEMORY_DIR=/workspace` |
| `logs/<container>/<deployment_id>/` | `/var/log/foresthub/` | rw | logger file sink (§5) |

- The engine reads/writes its memory under `/workspace` — local file I/O, **no network
  call, no credential.** This is what dissolves the memory-access auth question
  entirely: there is no `/agents/memory` endpoint to authenticate against.
- The component always writes to the **same in-container path** (`/var/log/foresthub/`);
  Ranger repoints that mount at a fresh host `logs/<container>/<deployment_id>/` dir on
  every pull. So the component is **deployment-agnostic** — it never knows or sets the
  deployment id; the host path carries it. (See §5.)
- A component may declare *additional* named volumes in its spec (`DeployComponent.volumes`)
  beyond these three; the three standard mounts are provisioned by Ranger from the
  container name, with no per-spec declaration.

## 4. Device-authoritative, backend-observational

- **Runtime writes never leave the device.** Memory, model files, durable broker state
  are written locally and read locally. The backend is not consulted at boot or on
  write.
- **The backend may observe.** For FE inspection and opt-in backup, the device may
  **push** workspace/log snapshots to the backend (authenticated by the Device-Key).
  This channel is **eventually-consistent and best-effort** — never authoritative, never
  required for the component to run.
- **Backup is a paid follow-up, not optional comfort.** Device disks fail (SD cards
  especially). Because Postgres no longer holds memory, durability is the device's —
  back it up (periodic workspace snapshot → backend/object store) or accept loss on
  disk death. State this in the paid tier explicitly.
- **Transfer = backup → restore.** Moving a component's identity to another device is a
  copy of its workspace directory (device → backend → new device), not a pointer
  re-point. This is the deliberate cost of device-authoritative state.

## 5. Logs

Logs are a **third category** — neither overwritten config nor user-managed workspace
data — and they follow the same device-authoritative, backend-observational shape as
the workspace.

- **Persist across deployments.** Logs must survive a redeploy, or you lose the record
  of the boot that just failed — the exact thing you are trying to debug. So logs live
  in `logs/`, not in the overwritten `deploy/` dir.
- **Partitioned by deployment — the path is the tag.** One subdirectory per deployment:
  `logs/<container>/<deployment_id>/`. The two dimensions every fleet query needs —
  **component** and **deployment** — are the `<container>` and `<deployment_id>` path
  segments, not fields the producer has to remember to set. Ranger owns the layout
  (it created it), so it derives both **structurally** when it ships. A component
  cannot forget, omit, or fake its own tags; it just writes to the path it was given.
  This also tags **non-SDK containers** correctly — anything Ranger can read
  `docker logs <container>` from gets the same treatment.
  - Restarts/crash-loops *within* one deployment share the deployment's subdir (correct
    grain — same spec generation belongs together). Rotation happens inside it.
  - "Everything from deploy N" = `logs/*/<deployment_id>/`; "this component's history" =
    `logs/<container>/` — both cheap globs for Ranger.
- **Components are credential-free; Ranger is the sole shipper.** Each component's logger
  has **console + rotated-file sinks only** — no network, no backend URL, no Device-Key.
  Ranger tails the files, stamps `component`/`deployment_id` from the path, batches, and
  best-effort POSTs to the backend's device-log plane. Only Ranger holds the credential
  and touches the network. This is the Greengrass nucleus/LogManager split, and it is
  why **no per-component secret injection is needed**.
  - *Interim:* until the file-tailing shipper lands, the engine keeps its existing
    direct-push HTTP sink (self-stamping `component=engine` + the injected deployment id),
    and Ranger ships only its own lines. The end state retires both.
- **The logger is shared, not engine-specific.** Both the engine and Ranger configure
  the same package (edge-agents `go/logging` — top-level, general-purpose:
  `Configure(level, writers…)` fanning console + a rotating file writer). Ranger
  replaces stdlib `log` with it, so Ranger's own reconcile failures land in
  `logs/ranger/<deployment_id>/` — fixing today's blind spot where a failed boot is
  invisible to the backend.
- **Two-layer retention** (different owners, different triggers):
  - *Device (Ranger), disk-budget.* `logs/` has a total-size cap; over budget, Ranger
    evicts whole `logs/<container>/<deployment_id>/` dirs **oldest-first,
    already-shipped-first**. The on-device file is a **bounded** buffer — a long backend
    outage on a small disk *will* drop the oldest unshipped logs, by design (an
    unbounded buffer is just deferred disk-exhaustion).
  - *Backend, time-based.* The backend log store ages rows out on its own schedule.

So: a log line is **partitioned by deployment, stored by component, persisted across
deploys until evicted, rotated, and shipped best-effort by Ranger** — with both tags
carried by the path, not the producer. See the backend's `docs/logging-overhaul.md`
for the ingest wire, the `device_logs` schema, and the backend retention job.

## 6. Secrets do NOT go in the workspace

Resolved secrets (MQTT passwords, broker credentials, model-endpoint keys) are
**resolved fresh at every pull** and must not be persisted in a directory that
survives deployments — that would put plaintext credentials at rest indefinitely and
break rotation-without-redeploy.

- Resolved secrets → **`deploy/<container>/`** (overwritten every pull) or injected env.
- Durable user/agent data (models, memory) → **`workspaces/<container>/`**.

Do not put a "credentials file" in the broker's workspace. The broker's *durable state*
(if any) may live there; its *credentials* are deploy-dir, refreshed each pull.

## 7. Seeding (create-if-absent)

When a workflow declares a memory file (e.g. `notes.md` with initial content), the
deploy must write it into the workspace **create-if-absent** — never clobber an
existing file, which holds accumulated content. This logic moves from the backend's
`seedMemory` (`fh-backend/internal/service/deployment.go`) to **Ranger**, as a
conditional file write at render time.

The uid-churn problem the old backend `Seed` solved (the builder mints a fresh uuid
when a memory file is re-created) **disappears on the device**: workspace files are
keyed by **name** (`notes.md`), not by a builder uuid, so there is nothing to re-key.

## 8. What this supersedes

The backend-authoritative memory model is removed:

- **Deleted (fh-backend):** `agent_memory_files` table, `internal/database/memory.go`,
  the memory service, and the `GET/PUT /agents/memory` endpoints. `seedMemory` becomes
  a Ranger-side create-if-absent write.
- **Auth simplification:** with no runtime memory channel, the engine needs **no
  backend credential for memory**. `agent_secret` as a stored identity loses its
  primary justification; logs route through the device log plane (the backend's
  `docs/logging-overhaul.md`), and in the end state only Ranger holds a credential.
- **Identity simplification:** the durable-state owner is the workspace directory keyed
  by container name, not an `agents`/slot row. Any remaining `agents` row is slim
  bookkeeping (e.g. MQTT identity), not the owner of durable data.

## 9. Open questions

- **Container-name stability across spec edits.** Need a deterministic naming function
  in the shared packaging library so a workflow edit that doesn't change a component
  still yields the same container name (and keeps its workspace). This is the lynchpin
  — specify it before implementing.
- **Workspace GC / "reset" UX.** Orphaned workspaces (renamed/removed components) are
  the user's to clean. Surface them; make "reset" an explicit, snapshot-taking action.
- **Log disk-budget tuning** — the total-size cap per device and the rotation
  thresholds within a deployment subdir. Policy is decided (§5: oldest-first,
  shipped-first eviction); the numbers are not.
- **Multi-component-per-name** is forbidden by construction (name is the key); confirm
  the renderer enforces uniqueness within a device.

> **Decided since first draft:** logs are *partitioned* by deployment (per-deployment
> subdirs), not stamped per line — so `component`/`deployment_id` are structural (§5).
> Backend push is **tail-from-file via Ranger as sole shipper**, not a per-component
> parallel sink. The logger package is the top-level `go/logging`, not `engine/logging`.
