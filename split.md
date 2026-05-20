# FE:

You have one core asset (types + serialization + the pure validator) that should produce three independent artifacts, none of which is "the editor embedded in the edge engine":

┌────────────────────┬────────────────────┬───────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────────────────────────┐
│ Artifact │ Language/runtime │ Job │ Consumes the core how │
├────────────────────┼────────────────────┼───────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
│ Edge engine │ Go, lean │ Run workflows on devices. Expose /debug + SSE only in debug mode. │ Doesn't. It runs workflows; it doesn't validate or edit them. Its only tie to │
│ (main.go) │ │ │ the editor is the debug protocol. │
├────────────────────┼────────────────────┼───────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
│ workflow-core │ Headless TS/JS │ Parse, serialize, validate a workflow JSON → structured │ Is the core. │
│ │ (npm) │ diagnostics. No React, no browser. │ │
├────────────────────┼────────────────────┼───────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────────────────────────┤
│ Visual builder SPA │ React/Vite │ Human inspect/edit in a browser window. │ Imports workflow-core for validation; adds canvas UI. │
└────────────────────┴────────────────────┴───────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────────────────────────┘

The edge engine never serves the SPA. The SPA and the validator live in TS/Node-land, because that's where the validator already is and where Vite/React is. The only legitimate seam between the Go
engine and the editor is the debug protocol — the engine owns it because only the engine can execute a workflow; the editor connects to it as a debug adapter. That's the real "engine ↔ editor"
boundary, not "engine hosts UI."

The strategic point: one extraction, four payoffs

Extracting workflow-core (types + the validateWorkflow(serialized) entry point + the already-pure expression checker) is the single foundational task. It's the same Snapshot↔Workflow boundary work
I flagged last turn — it just keeps converging because it's the actual leverage point. From that one extraction you get:

1. A CLI validator for Claude Code (the language-server-like role).
2. A leaner SPA that imports the same core.
3. An optional real LSP server later, if you want generic editor ecosystems.
4. A validation library the Go engine could even shell out to (or you port the rules) for deploy-time preflight without duplicating logic.

Do this extraction first, in the monolith. Everything else is downstream of it.

How it fits Claude Code — be concrete, and don't over-build

You floated two roles ("launchable browser window" vs "language server"). For an AI agent generating workflows, these are not equal. Rank them:

1. CLI validator → Claude Code skill/hook (build this first; highest value, lowest effort)

The agent loop you actually want is identical to how Claude uses tsc/eslint:

fh-workflow validate workflow.json

# exit 0, or exit 1 + JSON: [{severity, category, nodeId, message, range}]

Claude generates a workflow → a skill (or a PostToolUse hook on writes to \*.workflow.json) runs fh-workflow validate → diagnostics go back into context → Claude iterates until clean. This is the
single highest-leverage integration and it's cheap because the validator is already pure. Ship workflow-core + a ~100-line CLI wrapper that emits JSON and a real exit code, plus a thin skill that
calls it. That's the whole "language server for AI-generated schemas" requirement, satisfied without an LSP.

Pushback: do not build a full LSP server for the Claude Code use case. LSP is stdio JSON-RPC, document sync, incremental parsing, publishDiagnostics — designed for interactive editors with a live
buffer. An agent doesn't have a live buffer; it has a file and wants pass/fail + a diagnostics list. A CLI emitting JSON is simpler, easier to test, trivially composable in skills/hooks, and is the right primitive. Build the real LSP only if and when you want first-class VS Code/Neovim integration for humans hand-editing the workflow format — a separate, later, optional deliverable that
reuses the same workflow-core.

2. Launchable browser editor (build second; human-in-the-loop)

fh-workflow open workflow.json → spins a tiny local static/preview server, opens the browser to the SPA loaded with that file, writes back on save. This is the "inspect/edit" complement for when a
human wants to look at what Claude produced. It's more work (needs the React extraction done) and lower urgency than #1, because the validator alone already makes AI generation reliable. The
launcher is a dev-tooling process — explicitly not the edge engine.

3. Debug (later)

fh-workflow debug workflow.json --engine localhost:NNNN → the SPA connects as a debug adapter to a locally-running engine build (or cloud). Engine owns the protocol; editor is transport-agnostic.
This is where the Go engine repo legitimately participates — exposing the debug endpoint, not the UI.

Concrete deliverable shape

One npm-installable CLI, npx-friendly so a Claude Code skill can call it with zero install ceremony:

fh-workflow validate <file> # JSON diagnostics + exit code → the AI-validation role
fh-workflow open <file> # launch browser editor, write back on save
fh-workflow debug <file> --engine URL # optional: connect editor to a running engine
fh-workflow lsp # optional, much later: stdio LSP for generic editors

Plus a Claude Code skill wrapping validate (and optionally open). That skill + CLI is the "seamless Claude Code integration" you asked about — and notice none of it touches the Go edge engine.

Sequencing (revised, given the correction)

1. Extract workflow-core: parameterize validateAllCanvases() into validateWorkflow(serializedWorkflow), pull it + the expression parser + types + serialization out of React. Headless,
   Node-runnable. Do this in the monolith first.
2. CLI + Claude Code skill over workflow-core. This delivers the AI-validation value immediately, before any frontend split.
3. Extract the SPA to import workflow-core; add the open launcher.
4. Debug adapter: define the engine's debug protocol as the one editor↔engine contract; wire the editor as a client.
5. LSP server only if a human editor-ecosystem need actually materializes.

The reframe in one line: you're not embedding an editor in the engine — you're extracting a headless validator that the CLI, a Claude skill, and the browser editor all consume, while the Go edge
engine stays a lean runtime whose only tie to the editor is the debug protocol.

Want me to draft the validateWorkflow(serialized) extraction (what to lift out of diagnostics.ts:570 and how to feed it the serialized workflow instead of the stores), or sketch the CLI + skill
contract?

# BE:

I dug through the actual seam before answering — internal/engine/backend/client.go, build.go's Builder, and memory/manager.go:83 (if m.backend == nil → "treat
as no memory"). That nil-check pattern is the crux of your problem, so let me be blunt about it.

"Optional if backend not set" is the wrong mental model

Look at what actually degrades when backend == nil:

- Memory → "treat as no memory" (manager.go:83). Agents can't remember anything.
- RAG → retriever nodes are dead; embeddings + vector store live in the backend.
- LLM → only the backend-routed fallback is lost. llmproxy itself talks to OpenAI/Anthropic directly, so this one genuinely survives.
- Boot callback / heartbeat / log ingestion → pure control-plane chatter. Losing these standalone is correct, not a loss.

So with backend=nil you ship a graph interpreter + multi-provider LLM client that cannot remember or retrieve. That's meaningful as a workflow LLM
orchestrator. It is not a meaningful agent platform — memory and RAG aren't garnish on an agent engine, they're half the reason someone picks one over a for
loop around the OpenAI SDK. Be honest with yourself about which thing you're claiming to open source, because "optional" here means "amputated," and the
community will read it that way instantly.

The fix: stop making the backend optional — make it an interface

The real architectural defect (worth fixing even if you never open source) is that backend.Client is a concrete HTTP client literally named
fh-backend/internal/engine/backend, calling /agents/bootCallback, injected into memory.Manager, the retriever, and the LLM fallback. The if backend == nil
scattering is "the paid product or nothing" encoded into the engine.

Define engine-owned capability interfaces instead — MemoryStore, Retriever, LogSink, ControlPlane — and ship real local implementations in the OSS repo:

- MemoryStore → filesystem/SQLite. Trivial. Now OSS memory works.
- Retriever → pluggable, with a sample pgvector/qdrant impl.
- LogSink → stderr JSON (you basically have this).
- ControlPlane → no-op. Standalone engines have no control plane.

fh-backend (closed) becomes one implementation of those interfaces, living in the closed repo. This directly answers your question 2: yes, it's weird and it
reads as crippleware — but only because of the current dependency direction. Every reader seeing import "fh-backend/internal/engine/backend" and POST
/agents/bootCallback knows there's a paywalled thing they're a client of. Invert it: the OSS repo defines interfaces and has zero traces of fh-backend; the
SaaS coupling lives entirely in the closed repo implementing them. The "trace" is an artifact of dependency direction, and direction is fixable.

The blocker you're underestimating: internal/ + schema ownership

Everything is under fh-backend/internal/, which no other module can import. The engine imports internal/api, internal/domain, internal/mapping, internal/util. Worse: it uses api.Workflow, domain.DeviceManifest, domain.RAGQueryParams — types co-generated from the backend's OpenAPI spec. You stated the goal is users
editing "the workflow API format." That means the workflow schema must move to the open repo and become the contract, with the backend consuming it —
inverting current ownership. If you can't stomach inverting that, you aren't actually ready to open source; "open workflow format" would be fiction. This is
the hard work. The split is not "move two folders."

The fork question — your fear is backwards

- Crippled OSS engine (current trajectory): worst outcome. Capable users must implement their own memory/RAG/control-plane against your seam just to use it at all — so you've forced your most capable prospects to build the exact thing you sell, and given them zero reason to pay. That's the failure mode you're
  worried about, and the crippled version causes it.
- Complete OSS engine (local impls): most standalone users never pay — fine, they were never customers. The ones who hit multi-tenant memory, hosted vector
  infra, governance, fleet ops, audit come for the operated control plane + closed governance menu + hosting, not the binary. People self-host instead of buying when the SaaS doesn't add enough over self-hosting — not because the engine is forkable. This is textbook open-core (Temporal, n8n, Sentry, GitLab all live
  exactly here).

Forking the backend is allowed and mostly harmless — if your moat isn't the engine. From your own description (governance menu closed, hosting yours) your
moat is the operated/governed control plane. Open-sourcing the engine then strengthens you by making the workflow format a credible standard.

Recommendation

1. Do the interface refactor before any repo split. It de-risks everything and makes the engine testable without HTTP mocks regardless.
2. Move workflow-schema ownership to the open module. Backend depends on it, not vice versa. If you won't, you're not ready.
3. Never ship an engine that can't remember or retrieve. "Meaningful OSS" = useful to a solo dev with no ForestHub account. Otherwise it's a demo with a
   paywall and reviewers will say so.
4. Put the moat where you claimed it is: closed governance menu + hosted multi-tenant infra + ops + support. "Open builder editing a closed format on a
   crippled engine" is internally inconsistent; "open builder + open format + complete open engine + closed governance/hosting" is coherent.
5. llmproxy: cleanest thing to open source (genuinely standalone), but it's a crowded, low-differentiation space — strategic value is bundling it with the
   engine, not the package itself. Check it doesn't leak proprietary routing/cost/agent-runner heuristics before publishing.

One trap on the frontend split you mentioned: the visual builder must validate against the open workflow schema fully offline. If it needs the closed
governance backend to validate, you've rebuilt the exact crippleware problem in the frontend. Same rule everywhere: the open artifact must stand alone.
