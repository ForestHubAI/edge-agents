# mosquitto — ForestHub MQTT broker component

A thin wrapper over stock [`eclipse-mosquitto:2`](https://hub.docker.com/_/eclipse-mosquitto)
that enforces ForestHub's device auth and topic ACL **locally and offline** — no auth
plugin, no backend callback. A renderer delivers the roster and per-device secrets;
the entrypoint renders mosquitto's native `password_file` + `acl_file` at boot; the
broker authorizes every CONNECT and PUB/SUB itself, so it keeps working under a cloud
partition.

First-party, like the `llama` component: the backend resolves and pins its image (an
operator does not hand it to the deploy wizard). Its identity is `mosquitto` — named
for the implementation, because it wraps an upstream binary and keys an impl-specific
durable workspace. The MQTT-broker *role* lives in the seam (`contract/mqtt.yaml`,
`MQTTBrokerConfig`) and the workflow binding, both impl-neutral.

## What it reads

Two files at the fixed component-contract paths (`docs/component-contract.md`):

| Path | Shape | Written by | Holds |
|------|-------|------------|-------|
| `/etc/foresthub/config.json` | `MQTTBrokerConfig` (`contract/mqtt.yaml`) | the renderer | the **roster** — device ids allowed to connect |
| `/etc/foresthub/secrets.json` | flat `{ deviceId: hash }` | the secret resolver | per-device password **hash**, keyed by roster id |

```jsonc
// config.json
{ "roster": ["dev-a", "dev-b"] }

// secrets.json  — same ids as the roster
{ "dev-a": "$7$101$b64salt...$b64hash...", "dev-b": "$7$101$..." }
```

Durable broker state (retained messages, subscriptions) lives under the workspace
(`/var/lib/foresthub/workspace`), persisted across deploys.

A rostered device with no matching secret, or a missing/invalid `config.json`, is a
permanent boot failure — the entrypoint exits **78** (`ExitConfigError`) and the
orchestrator stops retrying.

## The secret is a hash, not plaintext — and why

Unlike every other credential a device holds, the roster secret is **hashed** before
delivery. A device's other secrets (its own `device_secret`, outbound provider keys)
are ones it *presents* on its own behalf, so plaintext-at-rest on its own box is
inherent. The broker is the exception: it holds credentials for **other** devices and
only ever **verifies** them. Verification needs no plaintext (mosquitto's
`password_file` is hashed, `/etc/shadow`-style), and plaintext here would put every
peer's reusable Device-Key on someone else's disk. So the resolver delivers
`hash(device_secret)`; a broker-host compromise yields only non-reversible digests.
Full rationale: `docs/mqtt-broker-migration.md`.

## The hash format the renderer must produce

mosquitto verifies against its own **PBKDF2** password format. The producer of
`secrets.json` MUST emit exactly this, or CONNECT silently fails:

```
$7$<iterations>$<base64(salt)>$<base64(digest)>
```

- **`7`** — mosquitto's PBKDF2-HMAC-SHA512 scheme id.
- **`iterations`** — decimal PBKDF2 iteration count (the producer picks it; it is
  stored here so the verifier reuses it).
- **`salt`** — standard base64 of the raw random salt bytes (mosquitto uses 12).
- **`digest`** — standard base64 of `PBKDF2-HMAC-SHA512(device_secret, salt, iterations, dkLen=64)`.

Reference generator (for testing a producer's output):

```sh
mosquitto_passwd -c -b passwd dev-a "$DEVICE_SECRET"   # writes a $7$ line
```

In Go the producer computes it directly:

```go
salt := make([]byte, 12); _, _ = rand.Read(salt)
const iters = 100_000
dk := pbkdf2.Key([]byte(secret), salt, iters, 64, sha512.New)
hash := fmt.Sprintf("$7$%d$%s$%s", iters,
    base64.StdEncoding.EncodeToString(salt),
    base64.StdEncoding.EncodeToString(dk))
```

> **Required CI acceptance test.** This is the one place a producer/verifier mismatch
> fails silently. Every producer of `secrets.json` MUST have a test that hashes a
> known secret, feeds it to a live mosquitto via this component, and asserts a client
> presenting the plaintext connects. Do not ship a producer without it.

Chosen over bcrypt (which mosquitto verifies only via the `mosquitto-go-auth` plugin)
deliberately: bcrypt is easier to produce, but it drags a compiled, arch-specific auth
plugin into the image to do what mosquitto's `password_file` does natively. The image
stays plugin-free; the producer carries the small, testable `$7$` reproduction.

## Topic grammar

`{deviceID}/…`, own-prefix publish, permissive subscribe, `presence` LWT leaf —
enforced by native `acl_file` per-device `user` blocks the entrypoint renders from the
roster (each: `topic read #` + `topic write {id}/#`). See [`ACL.md`](./ACL.md).

## Build

Built by hand or CI, never by the deploy wizard (first-party image, like the engine):

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -t ghcr.io/foresthubai/mosquitto:1.0.0 --push .
```

Treat semver tags as immutable and pin them. The broker listens on `1883`
(`contract/component-constants.json` → `mosquitto`); reached as `mqtt://mosquitto:1883`
by a same-device peer over the bridge, or via a published host port off-device.
