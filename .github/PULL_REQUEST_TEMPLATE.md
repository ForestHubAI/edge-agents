<!-- For a larger change, please make sure a related issue exists to align on it first. -->

## Description

<!-- Describe your changes and their purpose. -->

## Related Issues

<!-- Link related issues: Fixes #123, Closes #456 -->

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that changes existing behavior)
- [ ] Documentation update

## Checklist

- [ ] I have read [CONTRIBUTING.md](./CONTRIBUTING.md)
- [ ] Go: `go vet ./...`, `go build ./...`, and `go test ./...` pass (if `go/` is touched)
- [ ] TS: `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` pass (if `ts/` is touched)
- [ ] If I changed `contract/`, I regenerated **both** sides (`go generate ./...` and `npm run generate`) and committed the result
- [ ] I did not hand-edit generated bindings (`*.gen.go`, `workflow-core/src/api/workflow.ts`)
- [ ] I added or updated tests where applicable

## Contributor License Agreement

- [ ] I agree to the terms in [CONTRIBUTING.md § License and Contributor Agreement](./CONTRIBUTING.md#license-and-contributor-agreement), including ForestHub's right to relicense my contribution commercially in addition to AGPL-3.0.
- [ ] My contribution is my own original work and I am legally entitled to submit it under these terms.
- [ ] This contribution was created **outside** any employment, work-for-hire, or contractor obligations and **without** the use of employer-owned equipment, accounts, or time — **OR** my employer has explicitly authorized me to submit it under these terms and has waived any rights under §69b UrhG (or equivalent foreign law) for this contribution.
