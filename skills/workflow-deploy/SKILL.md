---
name: workflow-deploy
description: Turn a finished Edge Agents *.workflow.json into a runnable, standalone deployment bundle — the docker-compose package (engine + config + any llama-server components + any operator-authored custom components) an operator builds and runs on an edge/IoT controller. Drives the fh-workflow CLI's headless deploy, reading the workflow to learn which hardware pins, MQTT brokers, models, and keys it needs, asking the operator to fill or confirm each value, and writing the bundle while keeping secrets as placeholders so nothing sensitive ever lands in the chat. Use this whenever the user wants to deploy, bundle, package, or ship a workflow to a device or controller — e.g. "deploy this flow to my Raspberry Pi", "make a deployment bundle for the edge", "bundle workflow.json so I can run it on the controller", "ship my agent to the device", "put this workflow on the controller" — even when they don't say the word "bundle", and as the natural next step after generating a workflow. Not for building or editing the workflow graph itself (that is workflow-generate, or fh-workflow open) and not for cloud deployment.
---

# workflow-deploy

Take a validated `*.workflow.json` and produce a **standalone deployment bundle** the operator can
build and run on an edge controller: `docker-compose.yml`, the engine's boot config
(`engine-config.json` — workflow + device manifest + mappings + external resources, all in one blob),
a filled-in `engine.env`, a `deployment-spec.json` record, a `README.md`, and — depending on what the
workflow uses — one `llama-server` component per on-device model, plus any operator-authored custom
components.

The bundle is always **standalone**: the engine boots straight from `engine-config.json` and runs on
its own, no control plane. There is no clever first draft to get right — correctness comes from a
**read → ask/confirm → deploy → fix loop**, where the `fh-workflow deploy` command's own validation
is the ground truth. You read the workflow to know _what_ to ask, the operator supplies the physical
values, and the command tells you the moment anything required is missing.

**What you actually produce is one file — the `--values` JSON.** From that file plus the workflow,
`fh-workflow deploy` generates the _whole_ bundle on its own: the compose file, `engine.env`, the
`engine-config.json` (workflow + manifest + mappings + resources), `deployment-spec.json`, the
`README.md`, the components. You never hand-write any of those. So the task reduces to exactly this:
read the workflow, ask the operator for **every** value that can go into the values file — required
and optional alike — write the file in the right shape, point at any custom-component folders, and
run one command. Get the values file right and the bundle is right.

## When to use

The user has a `*.workflow.json` and wants to run it on a device — "deploy", "bundle", "package",
"ship to the controller", "put it on the Pi". This is the natural next step after `workflow-generate`
(which deliberately stops at the validated file).

Do NOT use this skill for:

- Building or editing the workflow graph — that's `workflow-generate` / `fh-workflow open`.
- Cloud deployment — this produces an on-prem, controller-local bundle only.

## How to run it

Everything runs through the **`fh-workflow` CLI** (the published `@foresthubai/workflow-cli`
package), invoked by its bare binary name — never a repo-local `node …/fh-workflow.mjs` path. The
CLI carries its own bundled contract, so it works from any directory.

**Confirm it's installed first:**

```bash
command -v fh-workflow
```

If that prints nothing, stop and tell the user to install it once with
`npm i -g @foresthubai/workflow-cli`, then continue.

**There's a manual path too.** An operator at a real terminal can just run
`fh-workflow deploy <workflow.json>` and answer the wizard's prompts interactively — that TTY path
_is_ the wizard. This skill is for the case where there's no terminal to drive: you gather the
answers in conversation and run the command headlessly with `--values`. Mention the manual command
if the user would rather fill it in themselves.

## The security posture (read this before Step 1)

This skill writes deployment files that carry **secrets** — provider API keys, MQTT passwords,
web-search keys. The firm rule, learned the hard way: **a real secret must never pass through you or
the conversation.** Concretely:

- **Never ask the operator to paste a key, password, or token.** For every secret field, write a
  **sentinel placeholder** (`REPLACE_ME_…`) instead, and tell the operator at the end which ones to
  replace. They fill the real values directly in the bundle's `chmod 600` files.
- **Never read secrets from the environment** to "be helpful" — no `cat`-ing `.env`-like files, no
  `printenv`. The operator's shell secrets are not yours to pick up.
- **Never `cat` or print `engine.env` or any custom component's `<name>.env`** (the bundle's `chmod
  600` files). Inspect them by `ls -l` / mode only, never content.
- The `--values` file you assemble may still be sensitive — write it `chmod 600`, never echo it, and
  remove it after the deploy.

`reference/values.md` lists exactly which fields are secret.

## Step 1: Read the workflow to learn what it needs

Read the `*.workflow.json` and enumerate everything that will need an answer — read
**`reference/values.md`** (next to this file) for the full shape and the lookup tables, then pull
from the workflow:

- **`channels[]`** — each entry's `type` is a hardware family or MQTT. The type→family→device-path
  table in `reference/values.md` tells you what to ask for (a gpio line vs an sysfs ADC path vs a
  serial device + baud).
- **`models[]`** — each is a custom model needing a binding: a `device` component (a `.gguf` filename)
  or a `network` endpoint (a URL you run elsewhere).
- **nodes** — an `Agent` whose `arguments.model` is **not** in `models[]` is a _catalog_ model and
  needs that provider's key. A `WebSearchTool` node needs `webSearch`. A **`Retriever` node is a hard
  stop** — a standalone engine has no retriever, so the bundle can't run; tell the user and don't
  proceed.

You don't have to perfectly predict the required set — the deploy command is the final authority and
will list any gap (Step 4). Reading the workflow is what lets you ask **good, specific** questions
instead of generic ones.

## Step 2: Ask for every value that can go in the file

The values file is a partial deploy config (full shape and tables in `reference/values.md`). Offer
the operator **every field that can go into it** — required _and_ optional. Required fields must be
answered or the command refuses to run. Optional fields you still **present**, each with a skip /
default choice: whether to set them is the operator's call, not yours to silently drop.

**Required — content-dependent, must be answered:**

- each hardware channel: `chipOrDevice`, plus an `index` for gpio/adc/dac/pwm (serial needs none)
- each MQTT channel: `brokerUrl`
- each custom model: `device` (a `.gguf` filename) **or** `network` (an endpoint URL)
- a `WebSearchTool` node ⇒ `webSearch.apiKey` (secret → placeholder)
- an `Agent` on a catalog model ⇒ the matching `llmKeys` entry (secret → placeholder)

**Physical addresses are exclusive.** Channels may share a device path (one chip, many lines), but
no two channels may use the same `chipOrDevice` + `index` pair, and a serial device belongs to
exactly one channel (regardless of baud). The command rejects duplicates (`… is already used by …`)
— so when collecting hardware values, never assign the same line/device twice; ask for a free one.

**Optional — offer each; default to leaving it out:**

- serial `baud` (engine default 115200)
- per MQTT channel: `username`
- per network model: `apiKey` (secret)
- `webSearch.provider` (default `brave`)

**Global settings — confirm, since the bundle lands somewhere real:**

- `outputDir` (default `./<workflow-name>-bundle`), `logLevel` (default `info`), `force` (overwrite an
  existing dir)

If the chosen `outputDir` already exists and is **not empty**, don't silently overwrite — hold the
same three-way choice the manual wizard offers: **overwrite** it (this sets `force: true`, which
_wipes_ the directory — any `.gguf` weights or hand-edits already there are gone — then writes
fresh), pick a **different directory**, or **abort**. Default to a different directory unless the
operator clearly wants to overwrite.

**One question-round at a time.** Send a single `AskUserQuestion` call and wait for its answers
before sending the next — **never fire two calls in the same turn**. A second questionnaire paints
over the first one the operator is still filling in, and they only see the earlier one again after
confirming it. One call may carry up to 4 related questions — that's a single round and is fine —
but walk the values through a few **sequential** rounds, never a parallel burst.

**One real default, only where a default makes sense.** Per question, offer exactly one substantive
option: a recommended default as the **first option, marked "(recommended)"** — and **never fabricate
alternative example values** (three made-up device paths or `.gguf` names help no one).
`AskUserQuestion` requires a second option, so make it the natural one and nothing more: _skip / leave
empty_ for an optional field, or _enter my own value_ — a pointer to the free-text entry — for a
required field that has no default.

Fields that have a sensible default (offer that value):

- hardware **device path**, per family: gpio `/dev/gpiochip0`, adc `/sys/bus/iio/devices/iio:device0`,
  dac `/sys/bus/iio/devices/iio:device1`, pwm `/sys/class/pwm/pwmchip0`, serial `/dev/ttyUSB0`
- serial **baud** `115200` · MQTT **broker URL** `tcp://localhost:1883` · network model **URL**
  `http://localhost:8080` · web-search **provider** `brave` · **outputDir** `./<workflow-name>-bundle`

Fields that have no sensible default (no default — pure input, or _skip_ if optional):

- GPIO line / channel **index** and a device model's **`.gguf` filename** — required, no default
- MQTT **username**, a network model's **apiKey** — optional ⇒ _skip_
- every **secret** (provider key, MQTT password, web-search key) — never a value, only a
  `REPLACE_ME_…` placeholder (see Step 3)

**`logLevel` is not a question** — default it to `info` silently (the operator tweaks `engine.env` on
the controller). **`force` is not a standalone question** either; it only arises from the output-dir
collision flow above. Use the type→family→device-path table in `reference/values.md` so hardware
questions stay concrete ("`gpioin` is a GPIO channel — which `gpiochip` and line?"), not open-ended.

**Secrets are never asked as values.** For a provider key, MQTT password, web-search key, or
network-model key, don't request the value — ask only _whether it applies_ (e.g. "does this broker
need auth?"), and if so write a `REPLACE_ME_…` placeholder in Step 3 and report it in Step 5. The
operator fills the real secret afterward.

Not a values-file field: a device model's context window is **not** something you set here — the
deploy freezes it into the component's compose `command` (default 4096), and changing it is a re-deploy,
not an env edit.

## Step 3: Assemble the `--values` file

Build a JSON object — a partial deploy config, shape in `reference/values.md` — with the operator's
answers as non-secret values and `REPLACE_ME_…` sentinels for every secret. Write it to a throwaway
temp file, locked down, and never echo it. `mktemp` creates a uniquely-named file in the system temp
dir (`$TMPDIR`, or `/tmp`) — so the later cleanup deletes exactly this one file and can never touch
anything else:

```bash
VALUES="$(mktemp)"; chmod 600 "$VALUES"
# write the JSON into "$VALUES" (e.g. with the Write tool), then use it below
```

Put **everything the operator chose** into this one file — including `outputDir`, `logLevel`, and
`force` — so the values file is the single source of truth and the command line stays just `--values`
(plus any `--component` folders from the next step). Omit only the optional fields the operator skipped
(the command fills their defaults). Don't print the file's contents back.

## Step 3b: Custom components (optional)

Beyond what the workflow needs, the operator may want to **co-deploy extra containers** alongside the
engine — a dashboard, a local metrics agent, a companion service. These are **custom components**, and
they are deliberately separate from everything above: they do **not** go in the `--values` file, and
they are **never** matched against the workflow graph — they just ride along in the same
`docker-compose.yml`.

A custom component is a **folder the operator already authored**, holding a `component.json` (the
container's declaration: name, image, `pull` policy, ports, volumes, an optional `config` blob) and
optionally a `<name>.env.example`. So this step is purely: **ask whether they have any such folders to
include**, and if so collect the path(s) — one per component. Pass each with a repeatable
`--component <folder>` flag on the deploy command (Step 4). If they have none, **skip this entirely**.

- **Never author a `component.json` yourself** and never invent a folder — a custom component is the
  operator's artifact; you only point at it.
- **Secrets stay folder-local.** A component's `<name>.env.example` becomes a `chmod 600` `<name>.env`
  in the bundle: filled (non-secret) defaults are taken, and any **empty** value is left blank — never
  prompted, never invented. These are placeholders the operator fills, exactly like `engine.env`; list
  the `<name>.env` files in Step 5.
- The deploy **validates each `component.json` against the contract**. A wrong shape, an unknown key,
  or two folders declaring the same name makes it exit non-zero with a precise message (Step 4) — fix
  the named folder or drop its `--component` flag, then re-run.

## Step 4: Deploy — run it, then fix what it reports

Run the command headlessly (no terminal ⇒ it takes the `--values` path):

```bash
fh-workflow deploy <workflow.json> --values "$VALUES"
# with custom components (Step 3b), add one --component per folder:
#   fh-workflow deploy <workflow.json> --values "$VALUES" --component ./grafana --component ./broker
```

The output dir and log level live in the values file, so the command line needs nothing but
`--values` (plus any `--component` folders). This is the gate. On a **non-zero exit**, read the
message and resolve it, then run again:

- **`Invalid values file (not a partial deploy config)`** — the file failed schema validation; each
  line names the exact spot and reason (e.g. `hardware.btn.index: expected number, received string`,
  an unknown/misspelled key, a model binding without a valid `location`). Fix exactly those entries
  in the values file, re-run.
- **`required values are missing: …`** — the command lists each gap (e.g. `hardware "btn": index`).
  Ask the operator for exactly those, add them to the values file, re-run.
- **`… is already used by "…"`** — two channels claim the same physical address (same chip + line,
  or the same serial device). Ask the operator which channel moves to a free line/device, re-run.
- **output dir exists / not empty** — the command exits rather than overwrite (it never wipes a
  directory on its own). If you didn't already settle this in Step 2, hold the overwrite /
  different-directory / abort choice with the operator now; overwrite means `"force": true`, which
  _wipes_ the dir. Set the result in the values file and re-run.
- **references a Retriever node** — the hard stop from Step 1; a standalone bundle can't run it.
  Don't try to force it; report it.
- **`invalid custom component(s)`** / **`duplicate component name`** — a `--component` folder's
  `component.json` failed contract validation (wrong shape, unknown key) or two folders declare the
  same name. Fix the named folder or drop its `--component` flag, re-run.

Cap at ~5 iterations. If gaps remain, report them honestly rather than claiming success — never
finish on a red exit. **Remove the values file on the way out either way** — `rm -f "$VALUES"` after
a successful deploy *and* when you give up — so the throwaway never lingers. (It's a single
`mktemp` path, quoted, no wildcard, so this only ever deletes that one temp file.)

## Step 5: Report

Give the operator:

1. **The bundle path and its files** — take this verbatim from the command's own success output;
   don't reason about which files "should" be there. The CLI always writes `engine-config.json`,
   `docker-compose.yml`, `engine.env`, `deployment-spec.json`, and `README.md` (even a no-secrets
   bundle has an `engine.env` — it carries the log level), and adds an `engine-secrets.json` (when any
   MQTT password / network-model key resolves), a `models/` folder, a custom component's `<name>.env` /
   `<name>-config.json`, etc. when the setup needs them. Never claim a file is absent that the command
   listed.
2. **The placeholders they must still fill** — prominently. List every `REPLACE_ME_…` you wrote:
   provider/web-search keys land in `engine.env`; MQTT passwords and network-model keys land in
   `engine-secrets.json` (the resource-credential doc). Also flag any custom component's `<name>.env`, where empty
   values were left blank. Remind them every such file is `chmod 600` and to keep it so.
3. **The defaultable values you set** (output dir, log level, and any baud), each with its
   value, and ask plainly whether any should change — so nothing was decided silently.
4. **The next step, without doing it**: build, transfer, and run are manual and documented in the
   bundle's generated `README.md`. Point there; see `reference/bundle.md` for a summary. Do **not**
   run `docker build`, `scp`, or `docker compose` yourself.

## Notes for Claude

- **The CLI is the ground truth.** Don't hand-roll a `docker-compose.yml` or guess the manifest
  shape — let `fh-workflow deploy` write the bundle and let its validation drive you. A bundle you
  assembled by hand is not done.
- **Secrets never touch the chat.** Placeholders only; never ask for, read, or print a real secret;
  never `cat` `engine.env` or a custom component's `<name>.env`. This is the one firm rule.
- **Retriever ⇒ no standalone deploy.** Stop and say so; don't work around it.
- **Standalone only.** This bundle has no control plane — the engine runs the one workflow it was
  built with.
- **device vs network models are different things.** `device` self-hosts a `.gguf` as a
  `llama-server` component in the bundle; `network` points at an endpoint the operator already runs.
  Ask which; don't assume.
- **Don't build or transfer.** The skill ends at a written bundle; building the image and copying it
  to the controller are the operator's steps, documented in the README.
