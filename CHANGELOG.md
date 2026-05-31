# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This repository hosts multiple release lines (Go binaries under `go/`, npm
packages under `ts/`) and each line follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
independently.

## [Unreleased]

### Added
- `fh-agent` CLI: compile `site.spec.yaml` into deployable edge-agent bundles.
- `fh-agent` CLI: contract-schema validation via `fh-builder` subprocess.
- `fh-agent`: dedicated `ROADMAP.md` alongside the CLI.
- Dependabot configuration for Go modules, npm packages, and GitHub Actions.
- Repository governance: `CODEOWNERS` for review routing, `FUNDING.yml`.

### Changed
- README rewritten as a category-defining, SEO/GEO-optimized engineering entry
  point; SLM/Local-provider story surfaced; hero tagline, Features section,
  ASCII diagram, and branded footer restored.

### Removed
- Commented-out `resilience.go` stub from `llmproxy`.

## [go/v1.0.1] - 2026-05-29

First tagged Go release after the `fh-core` → `edge-agents` repository rename.

### Added
- AGPL license header, `NOTICE`, and third-party notices across the tree.
- Initial README and community health files (issue templates, contributing).
- `cmd-engine`: standalone mode (operates without backend) and multi-arch
  Dockerfile.
- `cmd-engine`: CI workflow with image-tarball gitignore.
- Backend-routed LLM provider in `engine-backend`.
- `engine`: Lifecycle port (replaces `ControlPlane`); typed ports for LLM /
  Memory / Retriever with contract regeneration.
- MQTT channel: topic support; `line`/`channel` promoted to binding fields.
- Go `cmd` package wired back into the builder UI flow.
- Working CLI for the engine.
- Tests: `llmproxy-provider` now reads Vertex AI config from env; coverage
  expanded.

### Changed
- Repository renamed from `fh-core` to `edge-agents`; package layout
  flattened.
- `engine`: ticker and JSON-type helpers moved into the `mapping` package;
  logging extracted into its own package (`Activity` helper dropped).
- `engine`: memory tests isolated from the backend adapter.
- Workflow YAML: deployment mapping removed.
- Mapping promoted to a dedicated package; `engineapi` dependency removed
  from `engine`; mapping folded into `llmproxy`.

### Fixed
- Lockstep / CI contract-drift check.
- npm lockfile regeneration with optional deps (works around npm bug).

## [ts/0.1.1] - 2026-05-29

First documented release of the TypeScript workspace
(`@foresthubai/workflow-core`, `@foresthubai/workflow-builder`).

### Added
- Visual workflow builder SPA (`workflow-builder`) with drag-and-drop canvas,
  canvas tabs toolbar, and overhauled scrollbars.
- `workflow-core`: workflow schema migration infrastructure; builder
  auto-migrates workflows on load.
- Node library: model declared as a resource alongside the catalog; unified
  RAG and memory abstractions.
- Function configuration and diagnostics enhancements; function definition
  scoped at editor level rather than per-canvas.
- Parameter system overhaul and serialization streamlining across nodes and
  channels.
- Localization for toast messages and validation feedback.
- ESLint + Prettier setup across the TS workspace.
- TS release system (publish scripts under `ts/scripts/`).

### Changed
- `workflow-core` refactored; mapping promoted to its own package.
- Unified UI colors and node-library design; unified name de-duplication and
  selection model.
- `isDirty` tracking now driven by `mutationCount` in history.

### Fixed
- `Parameter.ts` casing corrected to match imports.
- Leaked React dependency in `workflow-core` removed; assorted code-smell
  cleanup, type errors, and tests referring to old nodes.

## [0.0.0] - 2026-05-19

Initial commit. Internal prototype prior to the first tagged release.

[Unreleased]: https://github.com/ForestHubAI/edge-agents/compare/go/v1.0.1...HEAD
[go/v1.0.1]: https://github.com/ForestHubAI/edge-agents/releases/tag/go/v1.0.1
[ts/0.1.1]: https://github.com/ForestHubAI/edge-agents/tree/main/ts
[0.0.0]: https://github.com/ForestHubAI/edge-agents/commit/d9e6f9d
