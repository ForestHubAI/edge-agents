# React Builder Weakness Audit

Perform a thorough audit of the React canvas in `ts/workflow-builder/src/` against five
categories. Use `Agent` subagents to explore categories in parallel where possible.

The builder is a presentation layer over the headless domain model in
`@foresthubai/workflow-core`. Most weaknesses here are the builder re-implementing,
hardcoding, or drifting from logic that the domain already owns.

## Reference: Domain Structure

Before auditing, understand the domain types in `@foresthubai/workflow-core` that the
builder SHOULD be using instead of hand-rolling its own logic:

- **`@foresthubai/workflow-core/node`** — `NodeData` union, `NodeType`, `NodeRegistry`,
  per-node definitions (`AgentNode`, `LogicNode`, `FunctionNode`, …)
- **`node/methods.ts`** — node-level methods: `getPorts()`, `getNodeOutput()`,
  `getNodeAvailableOutput()`, `getArguments()`, `getInput()`, `isNodeUsedAsTool()`
- **`node/NodeRegistry.ts`** — `NodeRegistry` singleton; use for definition/category
  lookups instead of hardcoded `node.type` checks
- **`node/NodeDefinition.ts`** — `NodeDefinition` (incl. `category`), `Port`,
  `PortDefinitions`
- **`node/FunctionNode.ts`** — `FunctionNodeDefinition`, `buildFunctionNodeDef()`
- **`@foresthubai/workflow-core/edge`** — `EdgeType`, `EDGE_DEFINITIONS`,
  `getEdgeDefinition()`, `isControlFlow()`, `isToolFlow()`

## Audit Categories

### 1. File Organization

Look for:

- Single-function utility files that belong in a nearby module
- Re-export files (`index.ts`) that add indirection without value
- Generically named files (`helpers.ts`, `utils.ts`, `common.ts`) whose contents could live in more specific modules
- Utility functions defined far from their only consumer
- Circular or tangled import paths between `workflow-builder` submodules
  (`components/`, `graph/`, `panels/`, `stores/`, `hooks/`, `inputs/`, `lib/`, `utils/`)

### 2. Component Props

Look for:

- Props marked optional (`?`) that are ALWAYS passed by every caller — should be required
- Required props that have an obvious default and could be optional
- Props drilled through 3+ levels that could use React context or a Zustand store
- Unused props (defined in interface but never read in component body)
- Props whose types are too wide (e.g., `any`, `unknown` where a specific type is known)

### 3. Legacy / Dead Code

Look for:

- Exported functions/types/constants with zero imports elsewhere
- Backward-compatibility shims, renamed variables, or `// removed` comments
- Fallback code for old data formats or migration logic that's no longer needed
- Commented-out code blocks
- `console.log` / `console.warn` left from debugging
- Unused local variables or unreachable code paths

### 4. Hardcoded Type Checks

The builder should defer to the domain instead of branching on raw type strings. Look for:

- Direct string comparisons like `node.type === "Agent"`, `node.type === "FunctionCall"`,
  `edge.type === "tool"` that could use:
  - Type guards or discriminated-union narrowing on `NodeData` / `EdgeType`
  - `NodeRegistry` lookups (e.g., checking `category` instead of `type`)
  - Domain methods from `node/methods.ts` (e.g., `getPorts()` instead of manual port logic)
  - `EDGE_DEFINITIONS` / `getEdgeDefinition()` / `isControlFlow()` / `isToolFlow()`
    instead of hardcoded edge-type checks
- Manual port/output computation that duplicates logic already in `getPorts()`,
  `getNodeOutput()`, or `getNodeAvailableOutput()`
- Hardcoded category strings that could reference `NodeDefinition.category`
- Switch statements over node/edge types that would break when new types are added

### 5. General Code Smells

Look for:

- Code that may introduce dormant bugs, such as:
  - Constant strings used in multiple places but not defined as a shared constant
  - Inconsistencies between the React layer and the domain model that could lose data
    or break on conversion
  - Inconsistent naming in constants and IDs
  - Mutable shared state (esp. outside the Zustand stores in `stores/`)
  - Complex nested conditionals
  - Large functions/components that could be broken down
  - Inconsistent naming conventions
  - Lack of error handling where it would be expected

## Output Format

Produce a structured report with the following format:

### Summary

- Total findings count
- Count per category
- Count per severity

### Findings by Category

For each category, list findings grouped by severity (high first):

```
#### [Category Name]

**[HIGH]** `ts/workflow-builder/src/path/to/File.tsx:42`
Description of the issue.
Suggested fix: ...

**[MEDIUM]** `ts/workflow-builder/src/path/to/File.tsx:100`
Description of the issue.
Suggested fix: ...
```

### Severity Definitions

- **HIGH** — Actively harmful: causes bugs, blocks extensibility, or duplicates domain logic that will drift
- **MEDIUM** — Structural debt: makes code harder to maintain, understand, or extend
- **LOW** — Style/hygiene: minor cleanups that improve consistency but aren't urgent
