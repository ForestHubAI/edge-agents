# MQTT topic ACL rules

The grammar this broker enforces, and why. It is enforced **locally and offline**
by mosquitto's native `acl_file` — no plugin, no backend callback (see the
enforcement section). This is the relocated, simplified form of ForestHub's earlier
backend-mediated grammar: the tenant boundary and the enforcement location changed;
the own-prefix design did not.

## Topic grammar

```
{deviceID}/[...topic-path]
{deviceID}/presence
```

**Segments:**

| Position     | Meaning                                                                                       |
|--------------|-----------------------------------------------------------------------------------------------|
| `deviceID`   | The publishing device's own id — equal to its authenticated username. The tenant is this broker itself, so there is no separate tenant segment. |
| `topic-path` | Any workflow-defined path (e.g. `sensors/temperature`, `events/door/opened`, `commands/lights/on`). |
| `presence`   | Reserved fixed-shape leaf — the only topic name with special meaning (the LWT topic).         |

The broker does not care what `topic-path` is. Topic naming is a workflow-authoring
concern — the engine wraps workflow-level event names with the sender prefix at
runtime. Workflow blueprints stay deploy-agnostic because they never reference peer
device ids directly.

## Access rules

| Action        | Allowed when                                                                     |
|---------------|----------------------------------------------------------------------------------|
| **Subscribe** | Any topic on this broker. Same-broker devices are peers; observability is permitted by design. |
| **Publish**   | `parts[0]` literally equals the authenticated device id — a device publishes only under its own prefix. |

Both rules are two lines in the rendered `acl_file` (see enforcement).

## Tenant == broker

There is no network object. **The broker instance is the tenant boundary.** Isolation
between tenants is separate broker components — want two isolated tenants on one
device, run two brokers. This is why the old `{network_id}` first segment is gone: a
single broker is a single tenant, so the first segment is simply the sender.

## The own-prefix pattern

Each device owns the entire prefix `{deviceID}/…`. The publish rule collapses to one
position-stable check — the first segment must equal the authenticated device id —
whatever workflow topic sits underneath. This is the canonical per-client topic
prefix (mosquitto's `%u` ACL idiom, AWS IoT Core's `${iot:ClientId}` substitution);
here it is rendered as a literal `topic write {id}/#` in each device's `user` block.
Because the sender is encoded in the topic and verified against the
authenticated identity, **a device cannot publish under another device's prefix —
sender spoofing is structurally impossible**, and receivers know who sent a message
without trusting the payload.

## Permissive subscribe

Same-broker devices are peers, not adversaries. A device may subscribe to any topic —
a specific peer's output (`{peer}/#`), one topic across all peers (`+/sensors/temperature`),
or everything (`#`). This supports debugging, monitoring, and collaborative workflows
without giving up the publish-side isolation above. To tighten per-device privacy,
constrain the subscribe pattern; the grammar is unchanged.

## Last Will and Testament (LWT)

On CONNECT every device should register:

- **`will_topic`**: `{deviceID}/presence`
- **`will_payload`**: `{"status":"offline"}`
- **`will_retain`**: `true` (so newly-subscribing peers see the last known state)

Immediately after connect the device publishes `{"status":"online"}` to the same
topic (also retained). On an ungraceful disconnect mosquitto publishes the will
automatically, so peers see the offline event in real time. `presence` falls under
the device's own prefix, so the own-prefix publish rule already authorizes it.

## Authentication

Devices connect with:

- **Username**: `device.id`
- **Password**: `device_secret` (the device's Device-Key)

mosquitto verifies the password **offline** against the delivered `password_file`:
it re-hashes the presented secret and compares it to the per-device PBKDF2 hash the
renderer resolved into the secret file. There is no callback to any backend, so
CONNECT succeeds under a cloud partition. After a successful CONNECT mosquitto
attaches the username to the connection and substitutes it as `%u` on every ACL
check — this is what makes the identity trustworthy per operation.

`client_id` (the MQTT session id) is **not** authenticated and must never be used for
identity decisions. Always use the username.

## Enforcement

The entrypoint renders the grammar above into mosquitto's native `acl_file` as one
`user` block per rostered device:

```
user dev-a
topic read #           # subscribe: any topic on this broker
topic write dev-a/#    # publish: only under this device's own prefix
user dev-b
topic read #
topic write dev-b/#
```

That is the whole ACL. Each block grants blanket read (permissive subscribe) and
write limited to that device's own `{id}/…` prefix (own-prefix rule), so a device
cannot publish under another's prefix. The blocks are regenerated from the roster on
every boot, in the same pass that builds the `password_file`.

Authenticated-user ACLs must live in a `user` block (or a `pattern` line with `%u`):
a global `topic` line — one before any `user` block — applies **only to anonymous
clients**, which are disabled here, so it would authorize nobody. The per-device
block is what actually authorizes a connected device.

### Wildcard safety

MQTT wildcards (`+`, `#`) are handled by mosquitto's pattern matcher. The publish
rule anchors on `%u/` — a literal per-connection prefix — so a client cannot widen
its publish scope with wildcards. (MQTT also forbids wildcards in publish topics at
the protocol level.) Subscribe is intentionally permissive, so wildcards there are
by design.

### The one rule native patterns do not enforce: `presence` shape

The earlier backend-mediated grammar also guaranteed `presence` was a fixed
three-segment leaf (no `{X}/presence/sub/path`). mosquitto's `pattern` matcher cannot
express "exactly this depth", so this broker does **not** enforce the presence leaf
shape. This is deliberate and safe: it is defense-in-depth, not a security boundary.
A device can only ever affect topics under its **own** prefix (the own-prefix rule),
so the worst case is a device publishing a malformed message under its own
`presence` path — it cannot forge another device's presence. The leaf-shape
invariant, where it matters, is enforced upstream: the editor reserves `presence` in
validation and the engine rejects it as a defense-in-depth check.
