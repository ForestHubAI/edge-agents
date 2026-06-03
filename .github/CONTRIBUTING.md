# Contributing to edge-agents

Thanks for your interest in edge-agents! Please read our
[Code of Conduct](./CODE_OF_CONDUCT.md) before participating.

> Structure and APIs are still moving. Issues and discussion
> are very welcome — and if you're planning a larger change, please open an issue first so
> we can align.

## Ways to contribute

- **Report bugs** with the [bug report template](https://github.com/ForestHubAI/edge-agents/issues/new?template=bug_report.yml)
- **Request features** with the [feature request template](https://github.com/ForestHubAI/edge-agents/issues/new?template=feature_request.yml)
- **Improve docs** or fix small, well-scoped issues

## Repository layout

| Path        | What                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `contract/` | Language-neutral OpenAPI schemas — the **source of truth** for both Go and TS.                    |
| `go/`       | Go module: the engine runtime + LLM proxy. See [`go/CLAUDE.md`](../go/CLAUDE.md).                 |
| `ts/`       | npm workspace: `workflow-core`, `workflow-builder`, `workflow-cli`. See [`ts/CLAUDE.md`](../ts/CLAUDE.md). |

`go/` and `ts/` are independent — you only need the toolchain for the side you touch.

## Development setup

### Go (engine + LLM proxy)

Requires the Go version pinned in `go/go.mod`.

```sh
cd go
go generate ./...        # regenerate api bindings + mocks
go build ./cmd/engine
go vet ./...
go test ./...
```

Format edited files with `goimports -w <file>`.

### TypeScript (workflow model, builder, cli)

Requires Node 20+.

```sh
cd ts
npm ci
npm run generate         # regenerate workflow-core api types from the contract
npm run typecheck
npm run lint
npm run build
npm test
cd workflow-cli && npm run dev    # run the reference SPA (embeds the visual builder)
```

## The contract is the source of truth (read this first)

Go and TS both generate bindings from `contract/*.yaml`. **Never hand-edit generated
files** (`go/api/**/*.gen.go`, `ts/workflow-core/src/api/workflow.ts`). A contract change
is always:

1. edit `contract/*.yaml`
2. `cd go && go generate ./...`
3. `cd ts && npm run generate`
4. reconcile the hand-written domain/handler code on each side.

CI fails if the checked-in bindings differ from a fresh regeneration.

## Code style

- **Go** — see [`go/CLAUDE.md`](../go/CLAUDE.md): `zerolog` logging, `fmt.Errorf("...: %w")`
  error wrapping, `testify` tests, capability-suffixed interfaces. Format with `goimports`.
- **TypeScript** — see [`ts/CLAUDE.md`](../ts/CLAUDE.md): strict `tsconfig`
  (`noUncheckedIndexedAccess`), explicit barrel exports (no `export *`), validation on the
  domain layer. Lint with `npm run lint`.

## Testing

- Go: `go test ./...` (testify).
- TS: `npm test` runs Vitest over the colocated `*.test.ts` files in `workflow-core` and
  `workflow-builder`.
- New behavior is best submitted with tests. All checks must pass before a PR is
  considered: CI runs Go (vet / build / test -race), TS (typecheck / build / test), and a
  contract-drift check.

## Pull request process

1. **Open an issue first** to align on the change.
2. Fork and create a feature branch from `main`.
3. Implement, following the code style and the contract rule above.
4. Run the relevant build / test / lint commands. If you touched `contract/`, regenerate
   **both** sides and commit the result.
5. Open a pull request using the template.

### Commit messages

Use clear, prefixed messages: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`.

## License and Contributor Agreement

edge-agents uses a **two-tier license model**: the `contract/` and
`ts/workflow-core/` subdirectories are released under [Apache-2.0](../contract/LICENSE),
and all other components (engine, LLM proxy, workflow-builder, workflow-cli) are released
under [AGPL-3.0](../LICENSE) with the option for ForestHub to also offer them under a
separate commercial license for use cases that are incompatible with the AGPL
(commercial licensing: root@foresthub.ai). To keep this model viable, every
contribution must grant ForestHub the rights needed to offer it under both license
regimes.

**By submitting a contribution (pull request, patch, or any other code or
documentation change), you agree to the following terms:**

1. **Grant of copyright license.** You grant ForestHub and recipients of software
   distributed by ForestHub a perpetual, worldwide, non-exclusive, royalty-free,
   irrevocable copyright license to reproduce, prepare derivative works of, publicly
   display, publicly perform, sublicense, and distribute your contribution and such
   derivative works.

2. **Right to relicense.** You expressly agree that ForestHub may license your
   contribution, in whole or in part, under the AGPL-3.0 **and/or under any other
   license terms of its choosing, including proprietary and commercial licenses.**
   This right covers future versions of the AGPL as well as any successor or
   alternative licenses ForestHub may adopt.

3. **Grant of patent license.** You grant ForestHub and recipients of the software a
   perpetual, worldwide, non-exclusive, royalty-free, irrevocable patent license to
   make, have made, use, offer to sell, sell, import, and otherwise transfer your
   contribution, where such license applies only to those patent claims licensable by
   you that are necessarily infringed by your contribution alone or by combination of
   your contribution with the project.

4. **Originality and right to submit.** You represent that each of your contributions
   is your original creation and that you are legally entitled to grant the above
   licenses. If your employer has rights to intellectual property that you create, you
   represent that you have received permission to make the contribution on behalf of
   that employer, or that your employer has waived such rights for your contribution to
   edge-agents.

5. **No obligation and no warranty.** ForestHub is under no obligation to accept,
   include, or maintain your contribution. You provide your contribution "AS IS",
   without warranties or conditions of any kind, either express or implied.

6. **Governing law and jurisdiction.** This Contributor License Agreement and any
   contribution submitted under it shall be governed exclusively by the laws of the
   Federal Republic of Germany, excluding its conflict-of-laws rules. To the extent
   legally permissible, the exclusive place of jurisdiction for any dispute arising out
   of or in connection with this agreement is Germany.

You retain copyright in your contribution — this agreement grants rights, it does not
transfer ownership. Under German law (§29 UrhG), the grants above are to be read as the
broadest exclusive exploitation rights ("ausschließliche Nutzungsrechte") permissible,
including for presently unknown forms of use to the extent allowed by §31a UrhG.

You confirm these terms by checking the Contributor License Agreement boxes in the pull
request template when you open your PR. A maintainer verifies this before merging; a PR
whose CLA boxes are not checked will not be merged.

### Which license your contribution falls under

The repository uses a two-tier license model:

- Contributions to `contract/` and `ts/workflow-core/` are released under
  **Apache-2.0**.
- Contributions to all other paths (engine, LLM proxy, workflow-builder, workflow-cli) are
  released under **AGPL-3.0-only** with the option for ForestHub to also offer them
  under a commercial license (per the CLA above).

If your PR touches both tiers, the per-file license header (or, where absent, the
directory-level `LICENSE`/`NOTICE`) governs.
