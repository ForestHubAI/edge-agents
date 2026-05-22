# Domain Structure

The domain layer lives in `src/types/` and defines the data models for nodes, edges, and their serialization. It sits between the API schema (`src/api/openapi.yaml` → `src/api/generated.ts`) and the workflow-builder UI.

---

## 1. API vs domain separation

| Layer            | Files                                          | Role                                                                           |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| **API schema**   | `src/api/openapi.yaml`, `src/api/generated.ts` | Canonical wire format; used on export; regenerated with `npm run generate-api` |
| **Domain types** | `src/types/node/`, `src/types/edge/`           | Runtime models used by the workflow builder and consumed by the validator        |

The domain layer re-exports several types from the generated API schema (`DataType`, `Variable`, `Reference`, `Expression`, `FunctionInfo`). Node/edge instances and definitions are domain-only — they have no direct API counterpart.

---

## 2. Node structure

### NodeBase (`src/types/node/index.ts`)

Every node instance extends `NodeBase`:

```typescript
NodeBase {
  id: string;
  type: NodeType;
  label?: string;
  availableOutput: Record<string, NodeOutput>; // What the node can produce (computed from args)
  output: Record<string, NodeOutput>;          // What enters variable scope (after bindings)
  outputBindings: Record<string, OutputBinding>;
}

NodeOutput = { name: string; dataType: DataType }
OutputBinding =
  | { mode: "emit"; name: string }          // Create new variable
  | { mode: "assign"; variable: Reference } // Write to existing variable
  | { mode: "discard" }                     // Ignore output
```

`availableOutput` is recomputed via `getAvailableOutput()` whenever arguments change. `output` is derived from `availableOutput` + `outputBindings` via `computeEffectiveOutput()`. Both are stored on the node instance — consumers read `node.output` for variable scope (same access pattern as before the bindings refactor).

`output` is keyed by a uid. Single-output nodes use `SYSTEM_OUTPUT_KEY = "out-0"`.

### NodeType and NodeData (`src/types/node/index.ts`)

```typescript
NodeType =
  InputNodeType |
  OutputNodeType |
  AgentNodeType |
  LogicNodeType |
  TriggerNodeType |
  ToolNodeType |
  FunctionCallNodeType |
  DataNodeType;

NodeData = InputNode | OutputNode | AgentNode | LogicNode | TriggerNode | ToolNode | FunctionCallNode | DataNode;
```

Each concrete node type (e.g. `ReadPinNode`, `IfNode`) is defined in its category file (`InputNode.ts`, `LogicNode.ts`, etc.) and added to the union via the category-level union (e.g. `InputNode = ReadPinNode | SerialReadNode | RetrieverNode`).

### NodeDefinition (`src/types/node/NodeDefinition.ts`)

Static metadata for each node type — used by NodeLibrary, NodeConfigPanel, and diagnostics:

```typescript
NodeDefinition {
  type: NodeType;
  label: string;
  category: NodeCategory;   // Input, Output, Logic, Trigger, Tool, Agent, Function
  description: string;
  parameters: Parameter[];
  isUnremovable?: boolean;   // Cannot be deleted (e.g. OnFunctionCall)
  isSingleton?: boolean;     // Only one instance per canvas
}
```

### NodeCategory (`src/types/node/NodeConstants.ts`)

```typescript
enum NodeCategory {
  Input,
  Output,
  Logic,
  Trigger,
  Tool,
  Agent,
  Function,
}
```

### NodeRegistry (`src/types/node/NodeRegistry.ts`)

Singleton registry of all static `NodeDefinition`s. Initialized on first access.

```typescript
NodeRegistry.getByType(type): NodeDefinition | undefined
NodeRegistry.getByCategory(category): NodeDefinition[]
NodeRegistry.getAll(): NodeDefinition[]
NodeRegistry.register(definition): void
```

Function nodes are not in the registry — they are built dynamically via `buildFunctionNodeDef()` from `FunctionInfo`.

### NodeMethods (`src/types/node/NodeMethods.ts`)

Three switch-based functions that compute derived data from a node instance:

**`getPorts(node): PortDefinitions`** — returns `{ input: Port[], output: Port[] }` where `Port = { id, type: "control" | "tool", label? }`.

- Control ports go on sides (horizontal execution flow)
- Tool ports go on top/bottom (agent↔tool connections)
- Examples: triggers have no input and one control output; `IfNode` has one input and two outputs ("true"/"false"); `AgentNode` has both control and tool ports

**`getAvailableOutput(node): Record<string, NodeOutput>`** — computes what the node can produce based on its arguments.

- Single-output nodes (ReadPin, SerialRead, etc.) use `SYSTEM_OUTPUT_KEY` with hardcoded default names
- `AgentNode` uses `arguments.outputDefinitions`
- `FunctionCallNode` derives from `functionInfo.returns`

**`computeEffectiveOutput(available, bindings): Record<string, NodeOutput>`** — applies output bindings to available outputs. "emit" bindings produce variables (with the binding's custom name), "assign" and "discard" produce nothing. Result is stored as `node.output`.

**`getArguments(node): Record<string, unknown>`** — flattens `FunctionCallNode`'s `{ inputBindings }` into a single record; returns `arguments` directly for all other nodes.

### FunctionCallNode (`src/types/node/FunctionNode.ts`)

Special node type with nested arguments and a snapshot of its function definition:

```typescript
FunctionCallNode {
  type: "FunctionCall";
  functionInfo: FunctionInfo;   // Snapshot at creation (staleness detection)
  arguments: {
    inputBindings: Record<string, Expression>;  // arg uid → expression
  };
  // Output name overrides moved to outputBindings (emit mode name field)
}

FunctionNodeDefinition extends NodeDefinition {
  type: "FunctionCall";
  functionInfo: FunctionInfo;
}
```

### NodeSerialization (`src/types/node/NodeSerialization.ts`)

Bidirectional conversion between domain `NodeData` and API wire format:

- **`serialize(node, position)`** — strips hidden parameters, uses `!` assertions on fields validated by the diagnostics gate
- **`deserialize(apiNode)`** — reconstructs domain node, calls `getOutput()` to populate outputs, coerces optional strings to `""`

Both use exhaustive switch statements over `NodeType`.

---

## 3. Edge structure

### EdgeType (`src/types/edge/EdgeType.ts`)

```typescript
EdgeType = "control" | "tool" | "agentTask" | "agentTool" | "agentChoice" | "agentDelegate";
```

Node port handles themselves only carry `control` or `tool` — the four agent-\* variants exist only at the edge level, resolved at connection time based on source/target context.

Helper type guards:

- `isControlFlow(type)` — true for `control`, `agentTask`, `agentChoice`, `agentDelegate`
- `isToolFlow(type)` — true for `tool`, `agentTool`

Control-flow edges render as horizontal beziers; tool-flow edges render as vertical beziers.

### EdgeData (`src/types/edge/index.ts`)

```typescript
EdgeData extends Record<string, unknown> {
  prompt?: Expression;      // agentTask and agentDelegate
  description?: string;     // agentChoice, agentTool, and agentDelegate
}
```

Edge data is stored in ReactFlow's `edge.data` and keyed by `parameter.id` from the edge definition.

### EdgeDefinition (`src/types/edge/EdgeDefinition.ts`)

Static metadata per port type — parameters, label, description:

```typescript
EdgeDefinition {
  label: string;
  description: string;
  parameters: Parameter[];
}
```

`EDGE_DEFINITIONS` maps each `EdgeType` to its `EdgeDefinition`. Notable entries:

| EdgeType        | Parameters                                    |
| --------------- | --------------------------------------------- |
| `control`       | none                                          |
| `tool`          | none                                          |
| `agentTask`     | `prompt` (expression)                         |
| `agentChoice`   | `description` (string)                        |
| `agentTool`     | `description` (string)                        |
| `agentDelegate` | `prompt` (expression), `description` (string) |

### Edge type resolution

The port handle kind (`"control"` or `"tool"`) is resolved to a specific `EdgeType` based on the source and target nodes. For example, a control edge from an `AgentNode` to another node may become `agentTask`, `agentChoice`, or `agentDelegate` depending on context. This resolution happens at connection time.

### Edge serialization

Edge serialization lives alongside node serialization. Edges are serialized with their `EdgeType` and data fields. On deserialization, the edge type determines which `EdgeDefinition` applies.

---

## 4. Files to update when adding/changing a node type

| File                                  | What to add/update                                                          |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `src/api/openapi.yaml`                | Node schema under `components/schemas`, add to `Node` oneOf + discriminator |
| `src/api/generated.ts`                | Regenerate from openapi.yaml (`npm run generate-api`)                       |
| `src/types/node/<Category>Node.ts`    | NodeData interface + NodeDefinition constant with parameters            |
| `src/types/node/index.ts`             | Add to `NodeType` union and `NodeData` union, export the interface      |
| `src/types/node/NodeRegistry.ts`      | Register the NodeDefinition in `initialize()`                               |
| `src/types/node/NodeMethods.ts`       | Add `case` in `getPorts()` and `getOutput()` (if the node produces outputs) |
| `src/types/node/NodeSerialization.ts` | Add `case` in both `serializeNodeByType()` and `deserialize()`              |

## 5. Files to update when adding/changing an edge type

| File                               | What to add/update                                           |
| ---------------------------------- | ------------------------------------------------------------ |
| `src/api/openapi.yaml`             | Edge schema if the wire format changes                       |
| `src/types/edge/EdgeType.ts`       | Add to `EdgeType` union, update `isControlFlow`/`isToolFlow` |
| `src/types/edge/index.ts`          | Add fields to `EdgeData` if needed                       |
| `src/types/edge/EdgeDefinition.ts` | Add entry in `EDGE_DEFINITIONS` with parameters              |

## 6. API field → NodeData argument type

The `NodeData` interface (`src/types/node/<Category>Node.ts`) must reflect the runtime type contract from [parameters.md section 3](parameters.md#3-definition--instance-mapping). Use the tables there to determine the correct TypeScript type for each argument field.
