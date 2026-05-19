---
name: workflow-validate
description: Validate a ForestHub workflow JSON file and return structured diagnostics. Use after generating or editing a *.workflow.json file.
---

# workflow-validate

SCAFFOLD. Thin wrapper over the `fh-workflow` CLI (TS, wraps
`@foresthub/workflow-core`). The CLI — not this skill — is the substantive
artifact; this is ~20 lines of glue.

Intended loop (mirrors how Claude uses `tsc`/`eslint`):

```
npx fh-workflow validate <file>
# exit 0  -> clean
# exit 1  -> JSON [{severity,category,nodeId,message,range}] on stdout
```

Claude generates a workflow → runs `validate` → diagnostics return to
context → iterate until clean. Deliberately NOT an LSP: an agent has a
file and wants pass/fail + a list, not stdio JSON-RPC document sync.

Build order: extract `workflow-core` (in place, under FE tests) → ship the
`fh-workflow` CLI over it → then wire this skill.
