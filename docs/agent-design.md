# The agent node: design philosophy, gaps, and the case for workflow-first

There are two ways to build an LLM agent. The industry has converged on one of them.
This repo deliberately implements the other, and this document explains why, what is
still missing before that bet pays off, and how the design fails if we are careless.

It is a design document, not a specification. Where it names a file or a line, that is
the current state of the tree, not a contract.

---

## 1. Two designs

**Runner-first** (Claude Code, most agent frameworks). The agent loop *is* the program.
A model sits in a `while` loop with a large, general tool set — read a file, run a
command, search the web — and an operator supervises it turn by turn. Control flow is
whatever the model decides next. Capability is bounded at call time, by a human
answering a permission prompt.

**Workflow-first** (this repo). A directed graph *is* the program. An LLM agent is one
node in it. The graph decides what runs, in what order, and what each agent may touch.
Capability is bounded at design time, by whoever authored the graph. Nobody needs to be
present at runtime.

Both run on the same provider API — our `llmproxy.ChatRequest` (`go/llmproxy/types.go`)
carries the same fields Anthropic's or OpenAI's does. The difference is not the wire.
It is **where the intelligence lives**: at runtime, deciding everything fresh each
execution, or at design time, baked into a reviewable artifact.

Design-time intelligence is diffable, signable, and auditable. Runtime intelligence is
none of those. On a device in a substation with no operator at 3am, that difference is
the whole product.

---

## 2. Design philosophy

### 2.1 The graph is the program; the agent is a node

`node.Agent` (`go/engine/node/agent.go`) is an `engine.Executable` like any other node.
It runs when the state machine reaches it, produces outputs into scope, and hands
control to a transition. It is not privileged. It has no ambient authority.

The consequence is that determinism and non-determinism are **separable and visible**.
A workflow author can put an LLM exactly where judgment is needed and nowhere else. A
threshold check stays a threshold check. A safety interlock stays a comparison. The
model is invoked for the one decision that genuinely needs language understanding, and
the graph does the rest.

This is the opposite of the runner-first premise, where every step — including
arithmetic, including "should I stop" — routes through the model.

### 2.2 Capability is a whitelist, authored as wires

An agent's tools are the nodes wired to its tool port. `Agent.AddTool` collects them at
build time; `Setup` freezes the list. There is no discovery, no ambient filesystem, no
shell. An agent that was not wired to a pin cannot read that pin — not "is not allowed
to", *cannot*, because the function does not exist in its tool list.

This is the same mechanism Claude Code's permission system implements, moved from
runtime to design time and from a human to an artifact. The trade is deliberate:

|                       | Runner-first          | Workflow-first        |
| --------------------- | --------------------- | --------------------- |
| Gate applied          | at call time          | at graph-build time   |
| Gate authored by      | a human at a prompt   | the workflow author   |
| Failure mode          | blocks, asks          | capability is absent  |
| Requires an operator  | yes                   | no                    |
| Capability set known  | at runtime            | statically            |

The last row is the commercially important one. Because the capability set is static, it
can be rendered, diffed, reviewed and signed — see §2.5.

### 2.3 The agent decides; the graph acts

An agent node can branch. When more than one control transition leaves it, `Setup`
switches the agent into structured-output mode and appends a legend mapping opaque
`choice_N` tokens to branch descriptions (`buildBranchingPrompt`). The model picks a
token; `next()` resolves it to a transition; the transition's target node performs the
action.

So the model's authority is *to choose among authored options*, not to act. Every
actuation on the device is an edge someone drew. This is what makes the design
defensible in a safety review: an LLM cannot invent an action that is not in the graph,
because acting is not something it does.

(§4-C revisits this: for the program-agent pattern, actuators must also be available as
tools. The gate then moves to the wire, which is still authored, still static, still
reviewable — but the distinction matters and should be a conscious choice per workflow.)

### 2.4 State is explicit, never implicit

Each `Agent.Execute` starts from `Scope.Conversation`, which is a **prompt stack**, not
a chat transcript. Its only three writers are the edge side effects in
`Transition.Apply` (`go/engine/types.go`):

- `agentTask` — replace the conversation with the evaluated prompt
- `agentDelegate` — append the evaluated prompt (or preserve as-is when absent)
- `agentChoice` — clear it

The agent's own answer does not enter it. Answers leave through the answer binding into
a named scope variable; anything that must survive to the next execution goes into a
declared output or a memory file. State is therefore **typed, named, and inspectable**
rather than hidden inside an opaque transcript.

This is a real design position, not an accident, and it is the right default for a step
agent: an execution is a function of (conversation, scope, tool set), which is what
makes replay and offline model qualification possible at all.

**The principle is "no hidden state", not "no transcripts."** Those are easy to
conflate, and the distinction is what reconciles this section with G5, which proposes
opt-in session retention. A transcript that accumulates because the runtime happens to
keep one is hidden state: it is not in the workflow file, it does not appear in a diff,
and nothing tells a reviewer what the agent still knows. A transcript a node retains
*because the workflow declares that it does* is explicit state — exactly like a declared
output or a memory ref: visible in the artifact, reviewable in a diff, and part of the
capability manifest.

So statelessness remains the **default**, because most agents are steps and should carry
nothing between executions. Retention is an **authored opt-in** for the program-agent
pattern (§6). What must never happen is retention becoming implicit, or a transcript
reaching a node that did not declare it.

### 2.5 The deployment is a signable capability manifest

Because tools are wired at design time and frozen at `Setup`, a deployed workflow
answers, statically, the question a customer's safety engineer actually asks:

> What can this thing do to my machine, and prove it.

"This agent may read the extractor RPM sensor and query the vibration model. It may act
only by selecting branch A (open damper) or branch B (hold). It may write to two memory
files. It has no other capability." That sentence is derivable from the workflow file.
No runner-first system can produce it, because its answer is only known at runtime.

This is the moat. Not the agent loop — that is commodity within eighteen months.

### 2.6 Designed for small local models

A frontier model can cope with thirty tools and an unstructured environment. A 7B model
on a device cannot. It needs a **closed, small, well-described world**: few tools, exact
descriptions, units and ranges on every reading, a bounded set of outcomes.

Capability whitelisting produces exactly that world as a side effect. This is the
non-obvious point: gating is not only a safety mechanism, it is *the reason small local
models are viable here at all*. A design that requires a frontier model to work is not
an edge product — it is a wrapper with a latency story.

---

## 3. What exists today

Working, and worth naming so the gap list below is read in proportion:

- **Tool wiring** — generic `engine.ToolProvider`; any implementing node becomes a
  function tool on the agents it is wired to.
- **Sub-agents** — `Agent.Tools()` exposes an agent as `prompt → answer`. This is
  structurally Claude Code's `Task` tool, and it composes: a supervising agent whose
  sub-agents are themselves narrowly-gated agent nodes.
- **Handoffs** — `agent.Handoff` switches the active agent (and optionally the model)
  mid-loop.
- **Memory** — `memory.Manager` owns durable `<uid>.json` records under
  `component.Workspace`; `memory.IndexCard` injects an index into the system prompt;
  `memory.Tools` synthesises `read_memory` / `append_memory` / `edit_memory` with the
  file name constrained by **enum** and write tools omitted for read-only refs; errors
  are translated into recovery instructions the model can act on.
- **Structured outputs and branching** — declared outputs with type coercion, and
  opaque-token branch selection.
- **Intra-run tool loop** — `Runner.Run` accumulates tool calls and results into
  `currentInput` correctly across turns.
- **Activity logging** — `llm_generate` per turn, `agent_run` on completion,
  `rag_query` on retrieval, all with `action`/`summary` fields.

---

## 4. Gaps: the superset checklist

The goal is not parity with runner-first. It is **strict superset**: everything a
runner-first agent can do, expressible in a workflow, plus the constraints. Today a
"super agent" — one agent node with everything wired, which is the runner-first pattern
expressed in our model — degenerates. These are the reasons.

Grouped by theme. Severity: **blocker** (the superset claim fails without it),
**major** (materially limits usefulness), **minor**.

### A. Continuity and state

**G1 — The transcript dies at the `Run` boundary. (blocker)**
`Runner.Run` builds `currentInput` correctly turn by turn, then returns
`RunResult{FinalOutput, LastAgent, Turns}`. The accumulated `InputItems` is never
returned, and `Agent.Execute` reads only `FinalOutput`. For a step agent this is correct
(§2.4). For a program agent it is amnesia every cycle: loop back into the same node and
it re-derives everything it already knew.

*Fix:* return the final `InputItems` on `RunResult`. This is plumbing — the transcript
already exists, only the exit drops it.

**G2 — There is no assistant message type. (blocker, prerequisite for G1)**
`llmproxy.InputItem` has exactly three implementations: `InputString`,
`ToolCallRequest`, `ToolResult` (`go/llmproxy/input.go`, `go/llmproxy/tools.go`). None
represents an assistant turn. So a model's own text *cannot be represented* in a
conversation — putting it back as an `InputString` would read as a user message to every
provider mapping.

*Fix:* add an assistant/message `InputItem` and map it in each provider. Nothing else in
this section is possible without it.

**G3 — Handoff drops the transition turn. (major)**
On handoff, `executeFunctionTools` returns `(handoff, nil, nil)` and the runner
`continue`s with `currentInput` unchanged. The receiving agent therefore sees the
conversation up to the *previous* turn: the handing-off agent's own text on that turn,
and the handoff tool call itself, are both absent. The new agent does not know why it
was called or what its predecessor concluded.

*Fix:* append the assistant turn (needs G2) and a handoff marker before switching. A
handoff should hand over the full conversation, which is the entire point of a handoff.

**G4 — `agentDelegate` carries prompts, not answers. (major)**
The delegate edge appends the evaluated prompt expression to the conversation. The
upstream agent's answer never enters it. A delegate chain therefore reads as a one-sided
stack of instructions. Continuity *is* achievable — the answer lands in a scope variable
and the next prompt expression can interpolate it — but nothing says so, and the default
is silently lossy.

*Fix:* document the interpolation pattern as the sanctioned mechanism, and surface it in
the builder. Defaulting an absent delegate prompt to the upstream answer is tempting but
makes edge behaviour depend on the upstream node type, which the transition does not
know. Prefer documentation plus builder affordance.

**G5 — No opt-in session retention. (blocker for the program-agent pattern)**
Statelessness is the right *default* and the wrong *only option*. Nodes are built once
and reused across executions, so a node can hold its own transcript.

*Fix:* a declared agent-node property (`retainConversation` or similar) on the workflow
contract. When set, the node keeps the transcript returned by G1 across executions and
seeds the next run with it; when unset, today's behaviour. Crucially the workflow file
*states* which mode a node is in — continuity becomes an authored, inspectable choice
rather than hidden accumulation. Triggers routing back into a retaining node then append
to the live session, which is the operator-chat / long-running-supervisor shape.

Ships together with G17 (compaction) or not at all.

### B. Loop robustness

**G6 — Any tool error kills the workflow. (blocker)**
`executeFunctionTools` returns an error on any tool failure; `Run` propagates it;
`Execute` propagates it; the runner dies. The agent gets exactly one attempt at every
tool call, forever. Runner-first systems are good largely *because* a failed tool is a
result the model corrects from, not an exception.

*Fix:* split by kind.
- **Model-recoverable** (bad arguments, no match, out of range, not found) → return as a
  `ToolResult` whose output describes the failure; the loop continues and the model
  retries. `memory.mapErr` already writes exactly the right kind of message — it is
  simply thrown away by the layer above.
- **Infrastructure** (device gone, component unreachable, context cancelled) → leave the
  node through an **error port**, so failure is a graph-visible branch the author
  handles (alarm, escalate, fall back to a deterministic rule) rather than a process
  crash.

The error port is the workflow-first answer and it is better than the runner-first one.

**G7 — `max turns exceeded` is an error, not an outcome. (major)**
A long-running agent hits a turn ceiling routinely. Today that is fatal.

*Fix:* exit cleanly with whatever the agent has, through a distinct outcome the graph
can route on.

**G8 — Structured output and tool use are mutually exclusive after turn one. (major)**
`Run` treats any non-empty text as final when `ResponseFormat != nil`. A branching agent
or one with declared outputs therefore cannot call a tool and then produce its structured
answer on a later turn — and branching agents are precisely the ones that most need to
gather evidence before choosing.

*Fix:* when a response format is set, only treat text as final if there are no
outstanding tool calls.

**G9 — Tool calls execute strictly sequentially. (minor)**
`executeFunctionTools` loops. Independent sensor reads serialise. Matters for latency,
not correctness.

**G10 — No "insufficient capability" outcome. (major)**
Gating converts "wrong action" into "silent under-performance": a model with no way to
obtain a reading confabulates one rather than saying so. Small models do this
constantly, and it is the failure mode our design *creates*.

*Fix:* a first-class outcome — "I could not determine this with the tools I have" —
that the graph routes deterministically. This does not exist in runner-first designs
because there the model is assumed to be able to go find out. It is native to ours.

### C. Capability coverage

**G11 — Write-side nodes are not toolable. (blocker for the program-agent pattern) — DONE**
`PinWrite`, `SerialWrite` and `MqttPublish` were graph-only, so a program agent (no
branches, everything wired as tools) was read-only and the pattern was dead on arrival.
All three are now `ToolProvider`s.

**The explicit wire is the gate** — a workflow that wires `PinWrite` as a tool has
authored that permission as visibly as one that wires it as a branch, and it appears in
the capability manifest either way. The builder should still make actuator-as-tool
visually distinct, because it is a meaningfully stronger grant.

The shape, now the house pattern for every toolable node:

- the value parameter is `activationRules: [{ type: "isControlFlow" }]` — the author
  supplies an expression in control flow, the model supplies it per call as a tool;
- `toolDescription` is `isToolInput` — the mirror image;
- the api field leaves `required` (activation-gated ⇒ never required, parameters.md §3)
  and the Go field becomes a pointer, nil-guarded in `Execute`;
- one shared implementation with the tool-call signature, called by both paths
  (`ReadPin.readPin` was the model);
- `Execute` casts before handing off, so the author's expression keeps its lenient
  conversion while the tool path gets `expr.Coerce` as a strict boundary on model input.

Tool schemas are per-instance where the type is: `write_pin` renders `boolean` for GPIO
and `number` (0–1 for PWM) for analog, `mqtt_publish` follows the node's declared
`dataType`. Those build `llmproxy.FunctionTool` by hand, since the schema can't come from
a Go type. `serial_write` is always a string, so `llmproxy.NewFunctionTool` derives it.

What the model may *not* choose stays author-owned: the channel, `qos`, `retain`,
`dataType`. The model picks what to publish, never where or how.

**G12 — Read-side coverage is inconsistent. (major) — mostly done**
`ReadPin`, `Retriever`, `WebSearchTool` were tool-providers; `WebFetch` was not, which
left an agent able to search the web but not read a page it found. `WebFetch` is now
toolable (`web_fetch(url)`); `maxChars` stays author-owned — it is a context budget, not
something the model should widen.

`Retriever` was toolable but its `query` was not activation-gated, so a tool-wired
retriever still demanded an unread query expression and diagnostics flagged it as a
missing required param. Fixed; the Go side already treated `query` as a tool parameter.

Deliberately **not** toolable:

- **`SerialRead`** — it is not an input in the sensor sense. It blocks for a human
  operator to answer a prompt. An agent must not be able to summon a human and wait; that
  belongs to control flow, where the author decided a person is in the loop. Do not
  "fix" this.

Still open:

- **`MLInference`** — deferred; the node's design is not finalized.
- **`CameraCapture`** — blocked on G13. Its output is an image, and the conversation
  cannot carry one, so a tool returning a frame has nowhere to put it.

**G13 — The agent is blind. (major)**
`agent.Agent` has no image field, `Runner` never populates `ChatRequest.ImageIDs` /
`ImageURLs`, and `InputItems` is text-only. A camera frame (`expr.ImageVal`) can reach
`MLInference` and nothing else. "A local VLM inspects the part" — a flagship industrial
edge use case — is currently inexpressible.

*Fix:* an image `InputItem` (shares the work in G2), image plumbing through `Agent` and
`Runner`, and `CameraCapture` as a tool provider (G12).

### D. Context and prompting

The system prompt today contains: user instructions, the branch legend, and the memory
index. That is all.

**G14 — No environment block. (major)**
The model does not know the current time, what device it is on, which trigger fired and
why, or what hardware exists around it. For anything involving "since last", trends,
shift schedules, or rate limits this is fatal. It is cheap to fix and it is the highest
value-per-line change on this list.

*Fix:* render an `## Environment` section per execution from `Resources`, the device
manifest, and the clock.

**G15 — Tool descriptions carry no physical grounding, and absence is never stated. (major)**

This is **not** a request to list the tools in the system prompt. Tool definitions are
already serialised into the prompt provider-side — Anthropic renders them into a
system-prompt section, OpenAI does the equivalent, and self-hosted models get them
through the chat template. Models are trained on that specific rendering, so a
hand-written prose list would be a second source of truth that drifts from the real tool
set, costs tokens, and contradicts the format the model was tuned on. Do not add one.

Two things the tool list genuinely cannot express:

- **Physical grounding belongs in the `description` field.** It is already in the schema
  and already injected; it is simply thin today. `"Extractor fan RPM, 0–3000 nominal
  1700–1900, sampled at call time"` beats `"reads pin 17"` by a wide margin on a small
  model. This makes G15 a *builder* item, not an engine one: units, ranges and physical
  meaning must be first-class, easy to author, and hard to omit.
- **Negative space.** The tool list says what exists; nothing says that nothing else
  does. Models — small ones especially — fill a gap by confabulating a reading rather
  than reporting they cannot obtain one. One or two generated sentences ("these tools are
  your only means of observing and acting; if what you need is not among them, exit via
  *X*") is additive and not expressible per-tool. It belongs with G10 and G16.

Branch outcomes are already covered by `buildBranchingPrompt` and need nothing further.

*Fix:* strengthen tool-description authoring in the builder; fold the negative-space
statement into the G16 block. Pairs with G25 — a good description that the model's chat
template never renders is worth nothing.

**G25 — Tool rendering is probably disabled on the llama component. (major)**

Pairs with G15, but it is a deployment problem, not a prompting one. The chain that
delivers a tool definition to a local model is:

1. `llmproxy` sends OpenAI-shaped `tools` (`provider/selfhosted/mapping.go`).
2. **llama-swap does no formatting.** It is a proxy and process manager: it selects a
   model, starts a `llama-server` for it, and forwards the request.
3. **`llama-server` (llama.cpp) does the formatting**, using the GGUF's embedded Jinja
   chat template (`tokenizer.chat_template`) — but tool rendering *and* tool-call
   parsing generally require the server to run with **`--jinja`**. Without it, llama.cpp
   takes its legacy built-in template path and tools are silently dropped.

`components/llama/entrypoint.sh` renders the launch command without `--jinja`:

```sh
printf '      %s --model %s/%s --host 127.0.0.1 --port ${PORT}%s\n' \
  "$SERVER_BIN" "$WORKSPACE" "$file" "${args:+ $args}"
```

So unless a per-model `args` entry supplies it, tools are likely never rendered. The
symptom is misleading: the model emits tool-call *text*, llama.cpp does not parse it into
`tool_calls`, `extractToolCalls` returns nothing, and the runner fails with
`"agent produced neither final output nor tool calls"` (`runner.go:160`) — which reads
like a model failure rather than a missing flag.

*Fix:* default `--jinja` in the entrypoint rather than relying on each model's `args`.
The knob already exists — `args` reaches `llama-server` verbatim — it is simply not
defaulted. `--chat-template-file` (staged in the workspace beside the `.gguf`) remains
the override for models whose embedded template handles tools badly.

*How to verify, per model.* Both binaries are in the image, so run a server directly,
outside llama-swap:

```bash
docker exec -it <llama-container> bash
llama-server --model /var/lib/foresthub/workspace/<model>.gguf \
  --host 127.0.0.1 --port 9099 --jinja --verbose &
```

- `curl -s localhost:9099/props` returns `chat_template` — check whether it has a
  `tools` branch at all.
- `--verbose` logs the final formatted prompt. Send one request carrying a tool and read
  what was printed; that is ground truth.

Run it with and without `--jinja` and diff. Flag names and endpoints vary between
llama.cpp builds, and the base image (`ghcr.io/mostlygeek/llama-swap:cpu`) is a moving
tag, so verify against the build actually shipped rather than trusting this paragraph.

The general lesson generalises past llama.cpp: **for self-hosted models, tool delivery is
a property of the serving stack, not of our prompt.** Any per-model workaround belongs at
the provider or component layer — never as a prose tool list in the system prompt, which
would reintroduce exactly the drift G15 rejects.

**G16 — Nothing tells the agent it is stateless. (major)**
An agent behaves as if continuity exists because nothing says otherwise. It needs to be
told, in the system prompt: you run as one node in a workflow; each invocation starts
fresh; anything you need next time goes into memory or a declared output; your answer
leaves through these named outputs; these are your possible outcomes.

*Fix:* a short generated "how you exist in this system" block. Cheapest item on the
list, and it changes behaviour immediately.

**G17 — No context management. (blocker, paired with G5)**
No tool-output truncation, no compaction. A program-length loop on an 8–32k local model
overflows. Retention without truncation just relocates the failure.

**Memory, specific:**

- **G18 — No full-replace tool. (major)** `ErrSizeExceeded` tells the model to "compact
  existing content first", but the only shrink primitive is `edit_memory` with an exact
  `old_string`. On a small model that is a dead end and it will loop. Add
  `write_memory(file, content)` for `rw` refs.
- **G19 — No eager mode. (major)** Every recall costs a turn and a decision the model
  must make; small models often will not. `CLAUDE.md` works because it is *already in the
  prompt*. Add a per-ref `auto` mode that inlines small always-relevant files into the
  system prompt, keeping today's tool path as `onDemand`.
- **G20 — The index is frozen at `Setup`. (minor)** Sizes — and, with G19, content — are
  boot-time, but the agent writes to its own memory during a run. Instructions should be
  rebuilt per `Execute`.
- **G21 — Write policy is undocumented. (minor)** Nothing says *when* to record. That
  belongs in each file's `description`, as a documented builder convention, not as more
  engine prompt.
- **G22 — Records live at the workspace root. (minor)** `memory.NewManager(component.Workspace)`
  writes `<uid>.json` directly into the workspace. Move to a `memory/` subdirectory
  before anything else claims that directory.

### E. Observability

**G23 — Tool calls are not logged. (major)**
`Runner` emits `EventToolCall` / `EventToolResult` to an *optional* `EventHandler`, but
only `llm_generate` and `agent_run` reach the logger. The decision trace is therefore
incomplete exactly where it matters most: what the model actually did.

*Fix:* log every tool call and result with the same `action`/`summary` shape. In a
regulated setting this record *is* the sellable artifact.

**G24 — No record/replay. (minor, high strategic value)**
Because an execution is a function of (conversation, scope, tool set), an invocation can
be captured and re-run offline against a different model. No persistent-transcript agent
can do this. It is a debugging story and a model-qualification story, and it falls out
of the design for nearly free.

### F. Summary table

| #   | Gap                                     | Severity | Area              |
| --- | --------------------------------------- | -------- | ----------------- |
| G1  | Transcript dropped at `Run` boundary    | blocker  | runner            |
| G2  | No assistant `InputItem` type           | blocker  | llmproxy          |
| G3  | Handoff drops the transition turn       | major    | runner            |
| G4  | Delegate carries prompts, not answers   | major    | engine/docs       |
| G5  | No opt-in session retention             | blocker* | contract + node   |
| G6  | Tool errors abort the workflow          | blocker  | runner + node     |
| G7  | Turn limit is an error, not an outcome  | major    | runner            |
| G8  | Structured output excludes tool use     | major    | runner            |
| G9  | Sequential tool execution               | minor    | runner            |
| G10 | No insufficient-capability outcome      | major    | node + prompt     |
| G11 | Write nodes not toolable                | ~~blocker*~~ done | nodes    |
| G12 | Read-side coverage inconsistent         | ~~major~~ mostly done | nodes |
| G13 | No vision path into the agent           | major    | llmproxy + nodes  |
| G14 | No environment block                    | major    | prompt            |
| G15 | Thin tool descriptions; absence unstated| major    | builder + prompt  |
| G16 | Statelessness never explained           | major    | prompt            |
| G17 | No truncation or compaction             | blocker* | runner            |
| G18 | Memory: no full replace                 | major    | memory            |
| G19 | Memory: no eager mode                   | major    | memory            |
| G20 | Memory index frozen at `Setup`          | minor    | node              |
| G21 | Memory write policy undocumented        | minor    | docs/builder      |
| G22 | Memory records at workspace root        | minor    | engine            |
| G23 | Tool calls not logged                   | major    | runner            |
| G24 | No record/replay                        | minor    | engine            |
| G25 | Tool rendering likely off on llama      | major    | component/deploy  |

\* blocker for the program-agent (runner-first-equivalent) pattern specifically.

---

## 5. The classical runner-first design

Stated fairly, because the comparison is worthless otherwise.

A runner-first agent is a loop: send the conversation, get back text or tool calls,
execute the tools, append the results, repeat until the model stops calling tools. The
transcript persists across the session. Tools are broad and general — filesystem, shell,
search — and the environment is described in a system-prompt preamble (working
directory, platform, date, repository state).

What makes the good ones good is not the loop, which is fifty lines:

1. **Ground truth.** Tools return facts, not opinions — a file's contents, a compiler's
   error, a test result. The model can always go check.
2. **Failure is in-band.** A tool error is a result the model corrects from. Nothing
   aborts.
3. **A rich environment preamble.** The model knows where it is before the first token.
4. **Context management.** Compaction keeps long sessions inside the window.
5. **A frontier model.** Much of the apparent magic is capability, not scaffolding.
6. **A human in the loop.** Permission prompts, interruption, steering.

Its genuine strengths: it handles situations nobody anticipated, needs no upfront
modelling, and rides the model-capability curve for free.

Its structural weaknesses, in our market: it cannot say statically what it may do; it
assumes an operator; and it degrades badly on small models, because the environment it
must reason about is unbounded.

Note items 5 and 6. A design that inherits its reliability from a frontier model and a
supervising human describes the *opposite* of an unattended edge device.

---

## 6. Why the workflow-first model is a superset

Once §4 is addressed, every runner-first capability has an expression here:

| Runner-first                    | Workflow-first equivalent                              |
| ------------------------------- | ------------------------------------------------------ |
| The agent loop                  | `agent.Runner` inside one agent node                    |
| Tool set                        | nodes wired to the tool port                            |
| Sub-agents / `Task`             | agent node wired as a tool (exists today)               |
| Session transcript              | `retainConversation` node property (G5)                 |
| Permission prompts              | design-time wiring; the capability manifest             |
| Environment preamble            | generated environment block (G14)                       |
| Errors handled in-band          | model-recoverable tool results (G6)                     |
| Compaction                      | truncation + compaction (G17)                           |
| "Run the whole program"         | one agent node, everything wired                        |
| — no equivalent —               | deterministic control flow around the model             |
| — no equivalent —               | static, signable capability manifest                    |
| — no equivalent —               | error and insufficient-capability branches              |
| — no equivalent —               | record/replay, offline model qualification              |

The superset property is what matters strategically: **a single agent node with
everything wired *is* the runner-first design.** The reverse is not true — auditable
design-time gating cannot be retrofitted onto a runner-first system without rebuilding
it as this one.

That gives two first-class patterns from one runtime:

- **Step agent** (default) — stateless, narrow tool set, branches into deterministic
  flow. The right shape for control, safety-adjacent decisions, and small local models.
- **Program agent** (`retainConversation`, actuators as tools, compaction) — the
  runner-first shape, still inside an authored capability manifest.

It is also the hedge. If frontier-class local models arrive in 2028 and the graph
becomes less necessary, we do not get stranded on the wrong side of the Bitter Lesson —
we flip a node property. If they do not, the graph is what makes small models work.

**Honest tradeoffs.** Three, and none of them go away:

1. **Authoring cost.** Every capability must be modelled. This is real, it is the main
   weakness of the design, and §7 is about nothing else.
2. **The model cannot discover what it lacks.** Gating produces silent
   under-performance rather than wrong action. That is the right direction to fail, but
   it must be made explicit (G10) or the model confabulates.
3. **Ceiling on emergent behaviour.** A workflow author who did not anticipate a
   situation leaves the agent unable to handle it. Runner-first would improvise —
   sometimes correctly, sometimes catastrophically. We are trading the tail of the
   upside for the tail of the downside. In industrial, that is the correct trade; in a
   general assistant it would not be.

---

## 7. Dangers, and how to avoid them

The design fails in predictable ways. Each of these is more likely than the technology
being wrong.

### 7.1 Becoming a graph integrator

**The danger.** Every capability must be explicitly modelled, so every customer becomes
an integration project. Revenue scales with headcount, margin collapses, and the
"product" is a consulting practice with a repo attached. This is the single most likely
way the business fails, and it is a *consequence of the architecture*, not bad execution.

**The avoidance: move the intelligence to design time, and automate it.**

```
device manifest  ──▶  generated graph  ──▶  human prunes/gates  ──▶  deployed artifact
(pins, units,         (tool-wired nodes,     (removes what the        (static capability
 ranges, semantics)    descriptions, ranges)  agent shouldn't have)    manifest + audit)
```

The manifest already exists — it arrives in `EngineConfig` and is read at boot. Deriving
the first-draft graph from it gives us the runner-first design's speed and coverage
without giving up the artifact:

- The units, ranges and physical semantics that make or break a small model come from
  the manifest **by construction**, not from a model's imagination.
- It is **re-runnable**: rewire a sensor, update the manifest, regenerate, review the
  *graph diff*. Prose-to-graph generation is one-shot and cannot be re-derived when
  hardware changes.
- It closes the audit loop: hardware truth → authored permissions → deployed capability.

The LLM still does the hard work of "figure out what this device can do and how to use
it" — it just does it once, at design time, supervised, with a diff a human reviews,
instead of every execution, unsupervised, unlogged.

`workflow-generate` already turns prose into a validated graph. Pointing that at a
device manifest instead of prose is the difference between a demo feature and the answer
to this section. **This should outrank most of §4 on the roadmap.**

### 7.2 A builder that is too restrictive

**The danger.** "No-code" degrades into "only the code we anticipated." A user with a
slightly unusual device hits a wall, and the honest answer is "file a feature request."

**The avoidance.** There must always be an escape hatch, and it must not be a
"run arbitrary code" node — that is where no-code products go to die: whose language,
sandboxed how, on a minimal edge container, audited how? We already ship the better
answer and simply do not market it: **the escape hatch is a component.** Author the code,
wrap it in a container (`components/README.md` has a no-build, env-only worked example),
wire it as a component call. One execution model, container-level isolation, and it
stays inside the capability manifest instead of punching a hole through it.

For the small cases — arithmetic, string handling, thresholds — the escape hatch is
`engine/expr` and the function node, not code.

### 7.3 An ever-growing node zoo

**The danger.** Every integration reflexively becomes a first-party node type: a schema
in `contract/workflow.yaml`, a Go builder branch, a TS builder branch, i18n strings, and
codegen in three languages — permanently, for what is often a configuration difference.
The contract becomes unmaintainable and every change becomes a three-language migration.

**The avoidance — the rule:**

> Nodes exist per **interaction semantic**. Resources have several. Components have
> exactly one, because their contract says so.

- **Resources** (GPIO, ADC, DAC, PWM, serial, MQTT) are spoken natively by the engine
  and have genuinely different interaction shapes: level read, edge trigger, stream,
  pub/sub, write. `OnMQTTReceive` is push; `MQTTPublish` is fire-and-forget; neither is
  "call and bind a result". Both correctly earn node types. Same for a pin read versus a
  pin-edge trigger — one resource, two semantics, two nodes.
- **Components** (onnx, camera, llama, custom) are request/response *by contract* —
  `docs/component-contract.md` fixes the shape and has no push. `MLInference` and
  `CameraCapture` differ only in URL and parameter schema. That is configuration.

The no-code promise survives intact: one generic component-call node whose parameter form
renders from the component's own `/metadata` descriptor — already contracted in
`ml.yaml` and `camera.yaml`, and already unused by the builder. The user still drags a
box and fills a form; adding an integration becomes a deploy-time fact rather than a
three-language contract change.

Two honest caveats: the descriptor must carry enough (labels, units, ranges, enums) that
the generic form is as good as a hand-built one, and a purpose-built node will always
have better polish. Keeping bespoke nodes for the two or three flagship components is a
defensible *product* decision — as long as it is a decision, priced honestly, and not
the default for the tenth integration.

If a component ever gains push semantics, that is a contract change first, and then it
earns **one** trigger node covering all push components — not one per component.

### 7.4 Betting against model progress

**The danger.** We build scaffolding that capable models make unnecessary, and the
Bitter Lesson eats the product.

**The avoidance.** Be clear about which parts are exposed. The *node zoo* and any
hand-built reasoning scaffolding are exposed — model progress erodes them. The *gating,
audit and deployment layer* is not: a safety engineer will still need a signable
capability manifest when models are twice as good, and fleet deployment does not get
easier. Invest accordingly, and keep the program-agent path (§6) open so improved models
translate into a configuration change rather than a rewrite.

### 7.5 Traceability theatre

**The danger.** We claim controllability while tool calls go unlogged (G23), errors
crash instead of branching (G6), and the capability manifest exists only as an argument
in a design document. The claim collapses the first time a customer audits it.

**The avoidance.** Ship the artifact. A rendered capability manifest per deployed agent,
a complete decision trace including every tool call, and a replay path. G23 and G6 are
not polish — they are the difference between the claim being true and being marketing.

---

## 8. Sequencing

Ordered by value, with dependencies respected. Items marked ◆ improve both agent
patterns and are worth doing regardless of the program-agent decision.

**Now — cheap, high value, no contract change**

0. ◆ G25 verify and default tool rendering on the llama component — one line, and
   nothing else on this list works on a local model without it
1. ◆ G16 statelessness + negative-space block, G14 environment block
2. ◆ G6 tool errors: model-recoverable in-band; infrastructure to an error port
3. ◆ G23 log tool calls and results
4. ◆ G18 `write_memory`, G20 rebuild instructions per `Execute`, G22 memory subdirectory

**Next — unlocks the program-agent pattern**

5. ~~G11 write nodes toolable, G12 read-side coverage~~ — done, except `MLInference`
   (design not final) and `CameraCapture` (blocked on G13)
6. G2 assistant `InputItem` → G1 return the transcript → G3 handoff carries it
7. G7 turn limit as outcome, G8 structured output with tools, G10 insufficient-capability
8. G5 `retainConversation` + G17 compaction (contract change; ship together)

**Parallel track — the business risk (§7.1), not the agent**

9. Component `/metadata` descriptor → generic component node
10. Device manifest → graph generation

**Later**

11. G13 vision, G19 memory eager mode, G24 record/replay, G9 parallel tools

G15 (tool-description authoring) sits on the builder track alongside 9 and 10, not on
the engine track.

Items 9 and 10 are independent of everything above and, on the argument in §7.1,
outrank most of the agent work.
