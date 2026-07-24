# MQTT: from BE-mediated auth to an on-device broker component

**Status:** design + migration plan. **The edge-agents side (Phase 0) is built and verified**:
the `mosquitto` broker component (`components/mosquitto/`), its `contract/mqtt.yaml` config seam,
and the `mosquitto` component-constants entry all live in edge-agents, with the offline
auth + ACL model validated against a live broker. This document covers the remaining
**fh-backend** migration (Parts 2–3, Phases 1–4), which is **not yet applied** — the old
`networkId` path stays live until Phase 4.

---

## Part 1 — The auth shift (reference this in edge-agents)

### The old model: the backend is the auth authority

Today an MQTT network is a backend concept. A `networks` row holds a broker connection
(`brokerUrl`) plus a `managedACL` flag; a `device_networks` row holds each device's
membership and (for external brokers) its credentials. When `managedACL = true`, the
broker delegates every auth decision to the backend:

- **CONNECT** → mosquitto-go-auth calls `POST /internal/mqtt/auth` (username = `device.id`,
  password = `device_secret`). The BE looks the device up by secret and confirms identity.
- **Every PUBLISH / SUBSCRIBE** → `POST /internal/mqtt/acl`. The BE loads the device's
  *live* managed-network memberships (`GetManagedMQTTNetworksByDeviceID`) and enforces the
  topic grammar `{network_id}/{from}/…` — publishes must stay under the sender's own prefix,
  the tenant is any network the device currently belongs to.

The defining property is that **membership is read live, on every ACL callback**. Reassigning
a device takes effect on the next message with no redeploy. That is genuinely useful — and it
is exactly what makes this model wrong once the broker moves to the edge.

### Why the old model breaks for an edge broker component

The moment the broker runs as a container on a device (so peers on a LAN/overlay can reach it),
routing auth back to the cloud backend is a mistake on four counts:

1. **Availability inversion.** A big reason to run a broker at the edge is local resilience —
   devices keep talking when the uplink is down. But every ACL check round-trips to the cloud.
   Lose the uplink and the local broker can't authorize *local* traffic. The edge broker stops
   working exactly when the edge most needs it to keep working.
2. **Latency on the hot path.** ACL is per-message. Even with per-connection auth caching, you
   are taking cloud round-trips inside the message path of edge-local pub/sub.
3. **An unauthenticated internal surface.** `POST /internal/mqtt/auth` trusts whoever calls it.
   With a broker on every customer device, that endpoint is effectively callable by anything
   that can reach the BE — a `device_secret` brute-force / ACL-probe oracle. Nothing
   authenticates the *broker* to the BE.
4. **It hardcodes one broker's auth model into the platform.** `managedACL` (bool) and the
   `MembershipCredentials` union (`none` | `mqtt-byob`) bake mosquitto's specific auth shape
   into the backend schema. Swap in a different broker with different needs (client certs, a
   different ACL grammar, no whitelist) and the *platform* schema has to change to accommodate
   a *component's* internals. That is backwards for a swappable-component system.

### The new model: the broker component owns auth, from delivered config

Auth and ACL move **onto the device**, into the broker component. The backend stops being the
synchronous authority and becomes the *source that composes and delivers* the policy:

- **The broker enforces locally.** On CONNECT and on every PUB/SUB, the broker component makes
  its own decision from config it already holds — no cloud call. It keeps working under a cloud
  partition.
- **Roster + ACL are component config, not platform tables.** The set of allowed devices and
  the ACL policy are part of the broker component's own configuration, delivered in the
  deployment spec and refreshed on pull. The backend treats the ACL grammar as opaque
  component config; it only needs to read the *allowed-device list* to resolve per-device
  secrets.
- **Per-device secrets resolve at pull.** The broker's config references device IDs; at pull
  the backend resolves each device's auth material (e.g. a hash of `device_secret`) into the
  broker's secret file, the same mechanism deployments already use for other secrets. A
  credential/roster change propagates on the next pull.
- **Tenant == broker (1:1).** A network no longer exists as a separate tenant object; the
  broker instance *is* the tenant boundary. Isolation between tenants = separate broker
  components. Consequently the topic grammar loses its `network_id` prefix and becomes
  `{deviceID}/…`, which the broker/engine derive locally from the connecting identity. Want
  two isolated tenants on one device → run two broker components.

### What the backend delivers vs. what the component owns

| Concern | Owner in the new model |
|---|---|
| Which devices may connect (roster) | Broker component config (authored on the broker deployment) |
| Auth material per device (secret hash / cert) | Backend resolves it into the broker's secret file at pull |
| ACL grammar / topic policy | Broker component (opaque to the backend) |
| Device identity | `device.id` + `device_secret` (unchanged) |
| Broker reachability for peers | Device reachability facts (`overlay_address` + `port_map[mosquitto]`) |
| Connection binding (which broker a workflow uses) | The workflow's MQTT binding (`{ brokerDeviceId }`) |

### Why the roster secret is *hashed* — the one file that isn't plaintext

Every secret the backend delivers to a device today is emitted **as plaintext**, and that is
correct. `DeploymentSecrets` resolves secret-manager refs and BYOB broker passwords to the
decrypted string; `DeploymentEnv` hands the engine `ENGINE_SECRET = device.device_secret`
directly. The invariant behind all of them:

> **Everything the backend emits today is a secret the receiving device presents on its own
> behalf.** `ENGINE_SECRET` is the device's own `device_secret` — it must present it to
> authenticate as itself. Resource credentials (LLM keys, a BYOB broker password) are things
> the device presents to connect *outward*. Presenting requires plaintext, so holding plaintext
> is inherent to the device's own function. There is no leak — it is the device's own key on
> the device's own box.

**The broker roster is the one place that violates this invariant.** The broker host holds
credentials for *other* devices, and it only ever **verifies** them — it never presents them.
Two consequences follow:

- **Verification doesn't need plaintext.** A hash suffices; mosquitto's `password_file` is
  hashed by design, `/etc/shadow`-style. The broker re-hashes the password the peer presents at
  CONNECT and compares digests — it never recovers the plaintext, so there is no key to
  distribute and nothing to de-hash. Hashing is one-way, not encryption.
- **Plaintext here would be a real leak.** `device_secret` is also each peer's Device-Key to
  the backend — a reusable, platform-wide identity credential. Plaintext-at-rest would put every
  rostered peer's credential on *someone else's* disk, so a single broker-host compromise would
  hand over every peer's identity. A hash yields nothing replayable.

So the roster needs a **new resolution arm**: same `DeploymentSecrets` transport (component =
broker, `resourceID` = peer device id), but the resolver emits `hash(peer.device_secret)`
instead of the plaintext string. The existing plaintext resolvers stay for own-behalf secrets;
the roster adds a hashed variant. This arm is the Phase-2 replacement for the network-based
`MembershipCredentialRef` / `resolveMembershipSecret` path deleted in Phase 4 — a `SecretRef`
that resolves a peer device id to a hash rather than a network membership to a plaintext
password.

### The contract edge-agents must define

For the backend to produce what the broker consumes, the edge-agents broker component must
pin, contract-first:

1. **Config schema** — the roster (allowed device IDs) + the ACL policy shape. The device-ID
   list must be machine-readable by the backend (for secret resolution); the rest may be
   opaque.
2. **Secret-file format** — how per-device auth material is delivered and where it is mounted
   (mirrors the engine's `<name>-secrets.json` convention).
3. **Auth mechanism** — how the broker verifies a connecting device offline: it re-hashes the
   presented `device_secret` and compares it against the delivered hash (see "Why the roster
   secret is *hashed*" above). No callback to the backend, no plaintext peer credential at rest.
   The pinned **hash format** is mosquitto's native PBKDF2 (`$7$<iterations>$<b64 salt>$<b64 digest>`,
   PBKDF2-HMAC-SHA512), which the backend must reproduce when it resolves `secrets.json` — chosen
   over bcrypt to keep the image plugin-free, so the producer carries the small, testable `$7$`
   reproduction. Format spec + the required producer acceptance test: `components/mosquitto/README.md`.
4. **Topic grammar** — `{deviceID}/…`, own-prefix publish rule, and any reserved leaves
   (e.g. `presence` for LWT), enforced locally. This is the relocated, simplified form of the
   current `internal/mqtt/ACL.md` grammar (drop the `{network_id}` segment).
5. **Image ref** — replaces `config.BrokerImage` (`"XXXXX NOT SET TODO"`). The image is
   `components/mosquitto/`, published like the engine image; the BE pins its tag.

**Delivered in edge-agents (Phase 0):** config schema → `contract/mqtt.yaml` (`MQTTBrokerConfig`);
secret-file format → the standard component `secrets.json` (flat `{deviceId: hash}`); auth
mechanism + topic grammar → `components/mosquitto/` (`entrypoint.sh` renders native
`password_file` + per-device `acl_file` blocks) with the ported `components/mosquitto/ACL.md`;
image ref → `components/mosquitto/` + its release workflow.

The grammar and rationale in `internal/mqtt/ACL.md` are worth preserving nearly verbatim in
edge-agents — the own-prefix pattern, wildcard-safety via literal identity checks, and the
reserved `presence` leaf are good design. Only the enforcement location and the `network_id`
prefix change.

### The one trade-off to accept

On-device enforcement means **revocation is no longer instant**: removing a device from a
broker's roster takes effect on the next pull/reconcile, not on the next message. This is
inherent to edge auth (AWS Greengrass's Client Device Auth has the same property — policy
propagates to cores, it is not synchronous). You gain offline resilience and lose instant
central cutoff. Accept it deliberately.

### Prior art

This is the AWS IoT Greengrass v2 client-device model: a local **Moquette** broker on the core
device, a **Client Device Auth** component that enforces authorization **on the core** from
pushed policy, an **IP Detector** that reports connectivity separately, and discovery that
hands clients the core's address. Auth on the edge, connectivity as a separate concern, one
broker per hub. We are arriving at the same decomposition.

---

## Part 2 — External bindings (the escape hatch)

Not everything is a component. A customer's existing broker (BYOB) or a customer-hosted model
endpoint (BYO-model) must be usable *without* deploying anything. These are handled uniformly
by an **external binding**: the binding carries the connection itself instead of the backend
resolving it from stored state.

- **Managed** (FH component on a device): `{ brokerDeviceId }` / `{ deviceId }` — resolved via
  device reachability; identity implicit (`device_secret`).
- **External** (BYO): `{ url, …, credentialRef }` — the binding carries the endpoint and a
  **secret ref** (never plaintext; the spec stays secret-free). The backend maps it to the
  engine resource type and adds the secret to the pull-time plan.

Key rule: the external binding is a **backend-owned authoring type**, mapped in `mapping/` to
the engine wire type (`engineapi.MQTTBroker`, `engineapi.LLMProvider`) — it is **not** the
engine wire type exposed directly. The escape hatch skips *resolution* (no lookup/derivation),
not *mapping*. Reusing `engineapi.*` on the public contract would leak derived/managed-only
fields (e.g. `PublishPrefix`), has nowhere to put the operator's credential (the engine type is
the secret-free resolved output), and would make every engine-internal reshape a breaking
public-API change. The mapping function is the seam/adapter.

Note: `engineapi.LLMProvider` already has a `SelfhostedLlm` + `Url` arm, so the external-LLM
shape maps onto an existing engine type. Verify only whether that arm can carry an auth
credential for an external URL (today's selfhosted URL is a trusted peer with no key); if not,
that is a small edge-agents add.

---

## Part 3 — Migration plan (fh-backend)

### Sequencing

- **Build the edge-agents broker component *contract* first** (Part 1 §"contract"). Phase 2
  codes against it — pin it on both sides before starting Phase 2 (same discipline as the
  double-pinned edge-agents YAMLs).
- **Additive BE work (Phases 1–3) is gated on the contract, not the finished component.** The
  old `networkId` path keeps working throughout.
- **Deletion (Phase 4) is last, gated on the new path passing E2E.** Never delete the working
  managed path before its replacement runs.

Only Phase 4 is destructive.

### Phase 0 — edge-agents (prerequisite) — ✅ DONE
The broker component contract is pinned and the component built: roster + config schema
(`contract/mqtt.yaml`), secret-file format (standard `secrets.json`), offline auth mechanism
(native `password_file`, `$7$` PBKDF2), `{deviceID}/…` grammar (`components/mosquitto/`), and
the image ref. Still open here: verify `SelfhostedLlm` can carry an auth credential for
external URLs (for Phase 1).

### Phase 1 — External LLM escape hatch (BE, additive, ships now)
Proves the pattern on the no-roster case; delivers BYO-model; no teardown.
- **openapi**: add `ExternalLlmBinding` arm to `ResourceBinding` (`{ url, model, credentialRef, apiFormat? }`).
- **bindings.go / mapping**: external branch → `engineapi.LLMProvider{Type: SelfhostedLlm, Url}` + secret-plan entry (`credentialRef` → account secret store, resolved at pull). Reuses `bindings.go:202` shape.
- Independent of networks and the broker component.

### Phase 2 — Managed broker-as-component (BE; needs Phase 0 contract)
- **openapi**: `MqttBinding` gains a **managed arm `{ brokerDeviceId }`** (coexists with `networkId`). `MqttBrokerRequest` is reshaped to carry the **roster + opaque ACL config** (with `networks` gone, roster authoring lands on the broker deployment). BE reads the device-ID list for secret resolution; ACL grammar is opaque passthrough.
- **deploy/resolve.go** (`MQTTConnection`): managed branch resolves `brokerDeviceId` → device row (`overlay_address` + `port_map[mosquitto]`) → `engineapi.MQTTBroker`, with a **self-vs-peer branch** (host dials localhost, peers via overlay); `device_secret` identity; **drop `network_id` prefix derivation**.
- **deployment.go** (`resolveBroker`): emit the broker component with roster config + a **per-device secret-hash secret file** (new pull-time surface, sibling to `MembershipCredentialRef`).
- **config/images.go**: `BrokerImage` → real ref (the pinned `mosquitto` component image). **port_map**: adopt the `mosquitto` component-key convention (the component's identity — impl-named like llama/onnx, since it wraps an upstream binary and keys an impl-specific workspace; the MQTT-broker *role* stays in the `MqttBinding` / `brokerDeviceId` seam).
- **Preflight**: `brokerDeviceId` reachable; best-effort warn if the target device's broker roster omits this device.

### Phase 3 — External MQTT escape hatch (BE)
- **openapi**: `MqttBinding` external arm `{ brokerUrl, username?, clientId?, credentialRef }` → maps to `engineapi.MQTTBroker` + secret (drops managed-only prefix fields). Replaces BYOB-via-network. Both MQTT modes now exist with no network dependency.

### Phase 4 — Cutover + deletion (BE; LAST, gated on E2E green)
- **Data**: if prod network data exists, migrate managed networks → broker-deploy rosters + rebind workflows to `brokerDeviceId`; BYOB networks → external bindings. If MVP/no data, this collapses to a straight drop.
- **Remove** the old `MqttBinding.networkId` arm.
- **DB migration**: `DROP TABLE device_networks;` then `DROP TABLE networks;` (the only live FK into `networks` is `device_networks`). Retire the membership-cred encryption path in `database/encryption.go`.
- **Delete**: `internal/mqtt/*` (handler, acl, port, ACL.md, tests), `handler/network.go` + its routes in `handler/server.go`, `service/network.go`, `database/network.go`, `domain/network.go`, `mapping/network.go`, `GetManagedMQTTNetworksByDeviceID` in `database/device.go`, and the `MembershipCredentials` / `managedACL` / `NetworkConfig` schemas.
- **openapi**: drop network CRUD paths + those schemas; `go generate` (types + server + mocks).
- **cmd/main.go**: unwire the mqtt handler + network service.
- **Docs**: delete `docs/networks.md`; update `tables.md`, `architecture.md`, `CLAUDE.md`, `README.md`, and the memory index.

### Properties
- Only Phase 4 is destructive; 1–3 are additive with the old path live.
- Reachability (migration 063) is untouched — the managed broker reuses `overlay_address`/`port_map` as an ordinary component.
- Accepted trade: on-device roster ⇒ revocation propagates on next pull, not instantly.

### Open decisions
- **Authoring surface for the roster** — `MqttBrokerRequest` carrying it is the current proposal; that is the one spot where "networks are gone" pushes real config onto the deploy request. Confirm before Phase 2.
- **Prod network data?** — determines whether Phase 4 is a data migration or a clean drop.
