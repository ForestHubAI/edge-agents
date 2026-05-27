# Releasing

This repo ships from one git history through two release systems that are
**orthogonal** — they share only the git tag namespace (partitioned by prefix), so they
never collide.

| Artifact                            | Ecosystem             | Version source            | Consumer pins with                          |
| ----------------------------------- | --------------------- | ------------------------- | ------------------------------------------- |
| `github.com/ForestHubAI/fh-core/go` | Go modules            | **git tag** `go/vX.Y.Z`   | `go get ...@vX.Y.Z`                         |
| `@foresthubai/workflow-core`        | npm (GitHub Packages) | `version` in package.json | `npm i @foresthubai/workflow-core@X.Y.Z`    |
| `@foresthubai/workflow-builder`     | npm (GitHub Packages) | `version` in package.json | `npm i @foresthubai/workflow-builder@X.Y.Z` |

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

### Registry: GitHub Packages

Both packages carry `publishConfig.registry = https://npm.pkg.github.com`.

**To publish**, npm needs a GitHub token with `write:packages`, supplied via `~/.npmrc`
(never commit it):

```
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

**To consume** (e.g. the private FE repo), add an `.npmrc` _there_:

```
@foresthubai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}   # token needs read:packages
```

then `npm i @foresthubai/workflow-builder@X.Y.Z` as normal. See
[`ts/workflow-builder/README.md`](ts/workflow-builder/README.md) for the Tailwind/styles
wiring the consumer must also do.

> **No automated changelog.** Put a one-line "what changed" in the release commit so the
> FE maintainer (often future-you) can see why a pinned version moved.
>
> **Going public** keeps the `@foresthubai` scope — you'd own that org on npmjs.com and
> drop the GitHub Packages registry line; the package name does not change.

## Go module — manual tag

The Go module lives in `go/`, not the repo root, so the tag **must** carry the
subdirectory prefix or the proxy won't associate it with the module:

```sh
git tag go/v1.2.3
git push origin go/v1.2.3
# consumers: go get github.com/ForestHubAI/fh-core/go@v1.2.3
```

For a v2+ major, the module path itself must gain the suffix
(`module github.com/ForestHubAI/fh-core/go/v2` in `go/go.mod`) and the tag becomes
`go/v2.0.0`. No registry push is needed — the Go proxy fetches on first request.
