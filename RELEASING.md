# Releasing

This repo ships from one git history through two release systems that are
**orthogonal** — they share only the git tag namespace (partitioned by prefix), so they
never collide.

| Artifact                            | Ecosystem             | Version source            | Consumer pins with                          |
| ----------------------------------- | --------------------- | ------------------------- | ------------------------------------------- |
| `github.com/ForestHubAI/edge-agents/go` | Go modules            | **git tag** `go/vX.Y.Z`   | `go get ...@vX.Y.Z`                         |
| `@foresthubai/workflow-core`        | npm (npmjs.org)       | `version` in package.json | `npm i @foresthubai/workflow-core@X.Y.Z`    |
| `@foresthubai/workflow-builder`     | npm (npmjs.org)       | `version` in package.json | `npm i @foresthubai/workflow-builder@X.Y.Z` |

Go and TS version on **independent cadences**. The two TS packages, however, are
**locked to each other** (see below) — they always ship one shared version.

The real coupling risk between Go and TS is **not** version numbers — it's `contract/`
drift. Keep the contract in sync and regenerate both sides; the version numbers are free
to diverge across ecosystems.

## TS (`@foresthubai/*`) — one lockstep command

`workflow-core` (headless) and `workflow-builder` (React) are **always released together
at the same version**, and the builder pins core to that exact version. They are split
into two packages only so a CLI can import core's validator without pulling in React —
not because they version independently. There is therefore no changeset/changelog
machinery: a release is a single command, run from `ts/`:

```sh
npm run release -- 0.2.0
```

`ts/scripts/release.mjs` then:

1. sets both packages' `version` to `0.2.0`,
2. pins `workflow-builder`'s `@foresthubai/workflow-core` dependency to exactly `0.2.0`,
3. refreshes the lockfile, and
4. runs `npm publish --workspaces` — which publishes core + builder and **skips** the
   private `@foresthubai/app`.

Each package's `prepublishOnly` rebuilds `dist/` first, so you never publish stale output.

### Registry: npmjs.org (public)

Both packages carry `publishConfig.registry = https://registry.npmjs.org` and
`publishConfig.access = public`, so the first `npm publish` ships the scoped
`@foresthubai/*` packages as openly installable on npmjs.org. No token or
`.npmrc` is required on the consumer side — `npm i @foresthubai/workflow-builder@X.Y.Z`
just works.

**To publish**, log in once on the machine that runs the release:

```sh
npm login           # interactive — uses the npmjs.org @foresthubai org account
npm whoami          # sanity check
```

Then from `ts/`:

```sh
npm run release -- X.Y.Z
```

The release script invokes `npm publish --workspaces`, which honours each
package's `publishConfig` and skips the private `@foresthubai/app`. Two-factor
auth on the npm account is recommended; if enabled, `npm publish` will prompt
for the OTP.

See [`ts/workflow-builder/README.md`](ts/workflow-builder/README.md) for the
Tailwind/styles wiring the consumer must also do.

> **No automated changelog.** Put a one-line "what changed" in the release commit so the
> FE maintainer (often future-you) can see why a pinned version moved.

## Go module — manual tag

The Go module lives in `go/`, not the repo root, so the tag **must** carry the
subdirectory prefix or the proxy won't associate it with the module:

```sh
git tag go/v1.2.3
git push origin go/v1.2.3
# consumers: go get github.com/ForestHubAI/edge-agents/go@v1.2.3
```

For a v2+ major, the module path itself must gain the suffix
(`module github.com/ForestHubAI/edge-agents/go/v2` in `go/go.mod`) and the tag becomes
`go/v2.0.0`. No registry push is needed — the Go proxy fetches on first request.
