---
name: workflow-generate
description: Generate a validated Edge Agents workflow JSON (*.workflow.json) from a natural-language description — the node-graph that runs on Edge Agents edge/IoT agents, built from triggers (timer, startup, pin edge, threshold, MQTT, serial), GPIO/serial/MQTT I/O, LLM Agent nodes, and actuators. Builds the graph to match the workflow contract and drives it to zero errors through the fh-workflow CLI's structural + semantic validators. Use this whenever the user describes automation or agent behavior in prose and wants a ready-to-run workflow file — e.g. "build a flow that reads a sensor every 10s and toggles a relay", "make an Edge Agents agent that summarizes incoming MQTT messages", "wire up a workflow where…" — even when they never say the words "workflow JSON". Not for visually editing an existing workflow (that is fh-workflow open) or merely checking one you already have (fh-workflow check-schema / validate).
---

# workflow-generate

Turn a plain-language description into a `*.workflow.json` that conforms to the contract and
**passes the CLI validators**.

There is no constrained decoding here — a skill is a prompt, not a schema-locked
decoder. Correctness comes from a **generate → validate → fix loop**, not from a
perfect first draft. The contract gives you the shapes; the two CLI gates give you
ground truth. Get close, then let the validators drive you to exit 0.

## When to use

The user describes a workflow in prose and wants a usable `*.workflow.json`.

Do NOT use this skill for:

- Editing an existing workflow visually — that's `fh-workflow open`
- Only checking an existing file — run `fh-workflow check-schema` / `validate` directly

## How to run it

All validation runs through the **`fh-workflow` CLI** (the published
`@foresthubai/workflow-cli` package), invoked by its bare binary name — never
through any in-repo `node …/fh-workflow.mjs` path. The CLI carries its own bundled
copy of the contract, so it works from any directory and needs no `edge-agents`
checkout.

**Before anything else, confirm the CLI is installed:**

```bash
command -v fh-workflow
```

If that prints nothing, stop and tell the user to install it once with
`npm i -g @foresthubai/workflow-cli`, then continue. Do not fall back to a
repo-local node path — the whole point is that this skill runs anywhere the CLI is
on `PATH`.

### Step 1: Understand the request — ask only about *pivotal* unknowns

A `*.workflow.json` is a cheap, throwaway text file — nothing is deployed, and
regenerating costs seconds. So the default posture is **assume sensible defaults
and build**, not interrogate. The fix for "don't decide things silently" is not an
interview up front; it's making the consequential assumptions **visible** in the
report (Step 5). Sort every unknown into one of three tiers:

1. **Mechanical** — no behavioral effect, or exactly one sensible value: canvas
   positions, internal channel/edge ids, output variable names, node ids. **Fill
   silently with a default; never ask, don't even surface it.**
2. **Consequential but defaultable** — affects runtime behavior, result, cost, or
   correctness, but has a reasonable default: LLM model, numeric data type
   (`int` vs `float`), intervals/thresholds, debounce, QoS/retain, signal type when
   a default is safe. **Pick a sensible default and build — do NOT block on it.**
   These get listed in the Step 5 report so the user can change them. Most
   parameters live here; asking about each would be the interrogation we avoid.
3. **Pivotal** — no safe default, or the choice cascades through the structure
   (an ambiguous trigger; digital vs analog when it changes the wiring; whether an
   `Agent` is even needed). **Only these are worth `AskUserQuestion`**, and only
   when the description leaves them open.

So: if the description determines the workflow, **skip the interview entirely** and
go to Step 2. When tier-3 unknowns remain, ask them — **bundled into one
`AskUserQuestion` call** (it takes up to 4 questions), each with the sensible
default as the **first option, marked "(recommended)"**, so one click accepts it.
Never fire several questions one after another.

Typical pivotal points: the trigger (`Ticker`/`OnStartup`/`OnPinEdge`/`Alarm`/
`OnThreshold`/MQTT/serial), whether hardware (pins/serial/MQTT) is involved at all,
and whether an `Agent`/LLM node is needed.

### Step 2: Load the shapes and the idioms

- Read **`reference/workflow.yaml`** next to this file — a snapshot of the
  contract, the source of truth for every field shape. (The CLI carries its own
  copy for validation; this bundled snapshot is your authoring reference. If the
  two ever disagree, the CLI gates win.) Look up the specific `*Node` schemas you
  need (each lists its `required` arguments) plus `Edge`, `Expression`,
  `OutputBinding`, `OutputDeclaration`, `Variable`, and the `Channel` variants.
  A few schemas are cross-referenced from **`reference/llmproxy.yaml`** (e.g.
  `ModelCapability`) — follow `llmproxy.yaml#/...` refs into that sibling snapshot.
- Read the **reference fixtures** in `examples/` next to this file — they are
  known-good, fully validated workflows that show the idioms by example:
  - `counter-agent.workflow.json` — `Ticker → SetVariable → Agent`: an `agentTask`
    edge with a `prompt`, an `OutputDeclaration` in `assign` mode, an `Expression`
    referencing a **declared** variable, a `declaredVariables` entry.
  - `gpio-pin.workflow.json` — `Ticker → ReadPin → WritePin`: `GPIOIN`/`GPIOOUT`
    channels referenced by id, an `OutputBinding` in `emit` mode, and a downstream
    expression that **references a node's emitted output** (see Notes — by output
    id, not the emit name), digital pins.

  Do **not** rely on any example files outside this skill folder — only these
  fixtures are guaranteed to exist and stay valid.
- For the **semantic rules the contract shape can't express** — which fields are
  truly required, why a schema-optional argument can still be mandatory — read
  **`reference/parameters.md`** next to this file (§1 presence table, §3 `optional`
  vs `activationRules`). Reach for it **on demand**, e.g. when `validate` reports a
  `missing-required-param`. Two semantic facts worth knowing up front: validation
  runs on the **deserialized domain, not the raw JSON**, so a file can pass
  `check-schema` and still fail `validate`; and a workflow on an older
  `schemaVersion` can be migrated with **`fh-workflow update <file>`**.
- **Only when the workflow defines or calls a reusable function** — i.e. a
  `FunctionCall` node and a non-empty top-level `functions` array — read
  **`reference/functions.md`** next to this file (the functions analog of
  `parameters.md`). It covers the semantics the contract shape can't show: a
  function is a *declaration* (the signature — `name`, `arguments`, `returns`) plus
  a *body* (its own canvas of nodes/edges); on the wire a `Function` is
  `{ functionInfo, outputAssignments, body }`; a `FunctionCall` references its
  target by `functionId` and carries the same flat uid-keyed `arguments` bag every
  node uses (`Expression` for inputs, `OutputBinding` for returns); return values
  are expressions on the declaration — **there is no return node, and a return with
  no assignment is a hard error**. The default sensor→agent→actuator workflows use
  none of this — skip it entirely unless a reusable function is genuinely in play.

### Step 3: Generate the workflow

**Where to write it.** Use the path the user gave. If they named only a folder,
write `<name>.workflow.json` inside it; if they gave a full path, use it verbatim.
If they gave nothing, default to the current working directory as
`<name>.workflow.json`. Always
end the filename in **`.workflow.json`** — that suffix is the convention the
tooling keys off.

Checklist for a clean first draft:

- All six required top-level fields present (`schemaVersion`, `nodes`, `edges`,
  `functions`, `declaredVariables`, `channels`); empty arrays are fine.
- Every node has `id`, `type`, `position`; the `type` discriminator matches a
  contract node exactly; required arguments per that node's schema are set.
- The graph starts at a **trigger** and every node is reachable from it via
  `ctrl`-port edges (see Notes — connectivity is validated).
- Declare any hardware/MQTT `channels` and reference them by `id` from the nodes
  that use them.
- Expressions list every variable they use in `references`.

### Step 4: Validate — mandatory two-gate pipeline, in this order

The gates run in a **fixed order, and the order is not optional**: the structural
schema check must be green **before** the semantic validator is run at all.

**Gate 1 — structural (`check-schema`). Loop here until it passes.**

```bash
fh-workflow check-schema <path>
```

It catches shape errors (wrong `type`, missing required field, bad enum) with a
JSON-pointer path like `/nodes/0/arguments`. On any non-zero exit: read the
diagnostics, fix the file, and run `check-schema` **again**. Keep editing the
workflow until `check-schema` exits 0. **Do not run `validate` while the schema
check is still failing** — a malformed shape must never reach Gate 2.

**Gate 2 — semantic (`validate`). Only once Gate 1 is green.**

```bash
fh-workflow validate <path>
```

It catches semantics: missing required parameters, unconnected nodes, type
mismatches, dangling references — reported as
`✗ [category] message (node …, param …)`. On any non-zero exit: read the
diagnostics, fix the file, and **go back to Gate 1** (a semantic fix can change
the shape, so re-check the schema first, then validate again). Repeat until
`validate` exits 0.

**Cap at ~5 iterations.** If errors remain after that, report the outstanding
diagnostics honestly instead of claiming success. Never finish with either gate
red.

### Step 5: Report

Give the path to the validated file plus a short summary (trigger, nodes, data
flow).

Then **list the consequential assumptions you made** — every tier-2 choice from
Step 1 you defaulted rather than asked about (LLM model, numeric data types,
intervals/thresholds, debounce, QoS, signal types, …), each with the value you
picked. Keep mechanical defaults (positions, ids, variable names) out of this list.
Close by asking whether any of these values should be changed — plainly, e.g.
"Should any of these be adjusted?" — so nothing was decided silently and the user
can correct it in one reply.

Finally, point at the natural next steps without doing either automatically:

- `fh-workflow open <path>` — inspect and edit the workflow visually.
- `fh-workflow deploy <path>` — turn the file into a runnable docker-compose
  bundle for an edge controller. The command interviews the operator for the
  concrete values the workflow needs (pins, MQTT brokers, models, keys); the
  **workflow-deploy** skill drives that wizard end to end.

Offer both and stop — do not start the deploy yourself. Only proceed when the
user opts in, and then go through the workflow-deploy skill rather than calling
`fh-workflow deploy` ad hoc.

## Notes for Claude

- **Both gates are mandatory, and `check-schema` always comes first.** Never run
  `validate` while the schema check is still red; never finish with either gate
  red. A workflow that wasn't taken through both gates to exit 0 is not done.
- **The contract is the source of truth.** When in doubt about a field, read
  `reference/workflow.yaml` (next to this file) — do not trust memory of the schema.
- **Rules the contract can't tell you** (the semantic validator enforces them —
  trust its diagnostics over any assumption):
  - The control port is **`"ctrl"`** on both ends of `control` / `agentTask` edges.
  - A node only runs if it is **reachable from a trigger** via `ctrl` edges;
    otherwise `validate` flags "will never run".
  - Some arguments the schema marks optional are **semantically required** (e.g.
    a pin node's channel reference, an `Agent`'s `model`); `parameters.md` explains
    which and why. If `validate` says "missing required parameter", add it even
    though `check-schema` passed.
  - To reference a node's **emitted output** in an expression, use the node's
    **output id** (often `"output"`) as the reference `varId`, not the emit `name`
    — the `name` is only a display alias. The wrong key surfaces as a
    `stale reference` in `validate`. See `gpio-pin.workflow.json`.
- **Never invent port names or channel ids** — wire to ids you actually declared.
- **Deploy only on explicit user opt-in.** Generating ends at a validated file;
  packaging it is the workflow-deploy skill's job. Suggest it, never start it
  unasked.
- **Discriminators are literal.** Every `type`/`mode` tag must match the contract
  exactly, or Gate 1 rejects the whole branch.
