---
name: workflow-generate
description: Build a ForestHub workflow JSON from a natural-language description, conforming exactly to contract/workflow.yaml, and validate it via the fh-builder CLI. Use when the user describes a workflow in prose and wants a ready-to-use *.workflow.json.
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

- Editing an existing workflow visually — that's `fh-builder open`
- Bundling a finished workflow for a controller — that's the `workflow-bundle` skill
- Only checking an existing file — run `fh-builder check-schema` / `validate` directly

## How to run it

All CLI commands run **from the repo root** and assume `ts/` deps are installed
(`cd ts && npm install`).

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

- Read **`contract/workflow.yaml`** — it is the source of truth for every field
  shape. Look up the specific `*Node` schemas you need (each lists its `required`
  arguments) plus `Edge`, `Expression`, `OutputBinding`, `OutputDeclaration`,
  `Variable`, and the `Channel` variants.
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
  truly required, why a schema-optional argument can still be mandatory — the canon
  is **`ts/workflow-core/docs/parameters.md`** (§1 presence table, §3 `optional` vs
  `activationRules`). Read it **on demand**, e.g. when `validate` reports a
  `missing-required-param`. For why a schema-valid file can still fail semantic
  `validate` (validation runs on the deserialized domain, not the raw JSON), see
  `ts/workflow-core/docs/architecture.md`; for `schemaVersion`/migration,
  `ts/workflow-core/docs/persistence.md`. These `workflow-core` docs are the
  authority — **ignore `ts/workflow-builder/docs/`**, which describe the visual
  editor, not this headless format.

### Step 3: Generate the workflow

**Where to write it.** Use the path the user gave. If they named only a folder,
write `<name>.workflow.json` inside it; if they gave a full path, use it verbatim.
If they gave nothing, default to the repo root as `<name>.workflow.json`. Always
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
node ts/app/cli/fh-builder.mjs check-schema <path>
```

It catches shape errors (wrong `type`, missing required field, bad enum) with a
JSON-pointer path like `/nodes/0/arguments`. On any non-zero exit: read the
diagnostics, fix the file, and run `check-schema` **again**. Keep editing the
workflow until `check-schema` exits 0. **Do not run `validate` while the schema
check is still failing** — a malformed shape must never reach Gate 2.

**Gate 2 — semantic (`validate`). Only once Gate 1 is green.**

```bash
node ts/app/cli/fh-builder.mjs validate <path>
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

Finally, point at the natural next steps without doing them automatically:
`fh-builder open <path>` to inspect visually, or the `workflow-bundle` skill to
ship it. **Never auto-bundle.**

## Notes for Claude

- **Both gates are mandatory, and `check-schema` always comes first.** Never run
  `validate` while the schema check is still red; never finish with either gate
  red. A workflow that wasn't taken through both gates to exit 0 is not done.
- **The contract is the source of truth.** When in doubt about a field, read
  `contract/workflow.yaml` — do not trust memory of the schema.
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
- **Discriminators are literal.** Every `type`/`mode` tag must match the contract
  exactly, or Gate 1 rejects the whole branch.
