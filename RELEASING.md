# Releasing

This repo ships from one git history through two release systems that are
**orthogonal** — they share only the git tag namespace (partitioned by prefix), so they
never collide.

| Artifact                                | Ecosystem           | Version source            | Consumer pins with                          |
| --------------------------------------- | ------------------- | ------------------------- | ------------------------------------------- |
| `github.com/ForestHubAI/edge-agents/go` | Go modules          | **git tag** `go/vX.Y.Z`   | `go get ...@vX.Y.Z`                         |
| `@foresthubai/workflow-core`            | npm (public, npmjs) | `version` in package.json | `npm i @foresthubai/workflow-core@X.Y.Z`    |
| `@foresthubai/workflow-builder`         | npm (public, npmjs) | `version` in package.json | `npm i @foresthubai/workflow-builder@X.Y.Z` |
| `@foresthubai/workflow-cli`             | npm (public, npmjs) | `version` in package.json | `npm i -g @foresthubai/workflow-cli@X.Y.Z`  |

Go and TS version on **independent cadences**. The three TS packages, however, are
**locked to each other** (see below) — they always ship one shared version.

The real coupling risk between Go and TS is **not** version numbers — it's `contract/`
drift. Keep the contract in sync and regenerate both sides; the version numbers are free
to diverge across ecosystems.

## TS (`@foresthubai/*`) — one lockstep command

`workflow-core` (headless), `workflow-builder` (React), and `workflow-cli` are **always
released together at the same version**; the builder pins core to that exact version.
core and builder are split only so a CLI can import core's validator without pulling in
React — not because they version independently; `workflow-cli` needs no pin because it
bundles core/builder from source at build time (they're its devDeps). There is therefore
no changeset/changelog machinery: a release is a single command, run from `ts/`:

```sh
npm run release -- 0.2.0
```

`ts/scripts/release.mjs` then:

1. sets all three packages' `version` to `0.2.0`,
2. pins `workflow-builder`'s `@foresthubai/workflow-core` dependency to exactly `0.2.0`,
3. refreshes the lockfile, and
4. runs `npm publish --workspaces` — which publishes core + builder + workflow-cli.

Each package's `prepublishOnly` rebuilds `dist/` (and the CLI bundle) first, so you never
publish stale output.

**After publishing, commit the version bump** — the script edits the three
`package.json` files and the lockfile but does not commit them. The `version` fields in
git are the only in-repo record of what was released; skip this and the repo silently
drifts behind the registry, and the next release picks a version npm already has.

```sh
git add workflow-core/package.json workflow-builder/package.json \
        workflow-cli/package.json package-lock.json
git commit -m "chore(release): publish @foresthubai/* X.Y.Z to npm"
```

### Registry: public npm (npmjs.com)

All three packages carry `publishConfig` targeting the public registry with public access:

```jsonc
"publishConfig": {
  "registry": "https://registry.npmjs.org/",
  "access": "public"
}
```

`access: public` is required — scoped packages (`@foresthubai/*`) publish as restricted
by default, which fails on a free org plan.

**To publish**, you must be a member of the `@foresthubai` org on npmjs.com and be logged
in (`npm login`). For CI, use an npm **automation** access token (bypasses 2FA) via
`~/.npmrc` (never commit it):

```
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

**To consume**

```sh
npm i @foresthubai/workflow-core@X.Y.Z
```

## Go module — manual tag

The Go module lives in `go/`, not the repo root, so the tag **must** carry the
subdirectory prefix or the proxy won't associate it with the module:

```sh
git tag go/v1.2.3
git push origin go/v1.2.3
# consumers: go get github.com/ForestHubAI/edge-agents/go@v1.2.3
```

## Container image

The engine image is built from [`go/Dockerfile.engine`](go/Dockerfile.engine) (multi-arch
`linux/amd64` + `linux/arm64`, distroless, nonroot). See the README's
[Run the engine](README.md#run-the-engine) section for the build / `docker save` /
`docker load` flow.
