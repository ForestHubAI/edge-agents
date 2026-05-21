import { NodeInstance, NodeOutput } from "./Node";
import type { OutputBinding, OutputDeclaration } from "../parameter";
import { PortDefinitions } from "./NodeDefinition";
import { resolveStaticOutputDataType } from "../parameter";
import { NodeRegistry } from "./NodeRegistry";
import { GraphEdge } from "../edge";

/** Read a static output's binding from a node's arguments bag, keyed by the output id. */
function getStaticBinding(args: Record<string, unknown>, outputId: string): OutputBinding | undefined {
  return args[outputId] as OutputBinding | undefined;
}

/**
 * Read-only helper: look up the current binding for a given output key on any node.
 * All static-style bindings (including FunctionCall returns) live at `arguments[outputId]`.
 * List output entries are OutputDeclarations, projected to an OutputBinding shape — only
 * emit-mode entries are addressable by uid here; callers that need to inspect assign-mode
 * entries should walk the declaration list directly via `arguments[out.id]`.
 */
export function getOutputBinding(node: NodeInstance, outputId: string): OutputBinding | undefined {
  const args = node.arguments as Record<string, unknown>;

  if (node.type === "FunctionCall") {
    return getStaticBinding(args, outputId);
  }

  const def = NodeRegistry.getByType(node.type);
  if (!def?.outputs) return undefined;

  for (const out of def.outputs) {
    if (out.type === "static") {
      if (out.id === outputId) return getStaticBinding(args, out.id);
    } else {
      const entries = args[out.id] as OutputDeclaration[] | undefined;
      const entry = entries?.find((e) => e.mode === "emit" && e.uid === outputId);
      if (entry && entry.mode === "emit") return { active: true, mode: "emit", name: entry.name };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// External input requirements for debug mode
// ---------------------------------------------------------------------------

/** Describes a hardware input a node needs before it can execute in debug mode. */
export type ExternalInput = { kind: "gpio"; pinReference: string | undefined; dataType: "bool" | "int" } | { kind: "serial" };

/**
 * Get ports for a node instance.
 */
export function getPorts(node: NodeInstance): PortDefinitions {
  switch (node.type) {
    case "ReadPin":
      return {
        input: [
          { id: "ctrl", type: "control" },
          { id: "tool", type: "tool", label: "As Tool" },
        ],
        output: [{ id: "ctrl", type: "control" }],
      };
    case "SerialRead":
    case "WritePin":
    case "SerialWrite":
    case "MqttPublish":
      return {
        input: [{ id: "ctrl", type: "control" }],
        output: [{ id: "ctrl", type: "control" }],
      };
    case "FunctionCall":
      return {
        input: [
          { id: "ctrl", type: "control" },
          { id: "tool", type: "tool", label: "As Tool" },
        ],
        output: [{ id: "ctrl", type: "control" }],
      };
    case "Agent":
      return {
        input: [
          { id: "ctrl", type: "control" },
          { id: "tool", type: "tool", label: "As Tool" },
        ],
        output: [
          { id: "ctrl", type: "control" },
          { id: "tools", type: "tool", label: "Tools" },
        ],
      };
    case "SetVariable":
      return {
        input: [{ id: "ctrl", type: "control" }],
        output: [{ id: "ctrl", type: "control" }],
      };
    case "If":
      return {
        input: [{ id: "ctrl", type: "control" }],
        output: [
          { id: "true", type: "control", label: "True" },
          { id: "false", type: "control", label: "False" },
        ],
      };
    case "Delay":
      return {
        input: [{ id: "ctrl", type: "control" }],
        output: [{ id: "ctrl", type: "control" }],
      };
    case "OnFunctionCall":
    case "Ticker":
    case "Alarm":
    case "OnStartup":
    case "OnPinEdge":
    case "OnSerialReceive":
    case "OnThreshold":
    case "OnMqttMessage":
      return {
        input: [],
        output: [{ id: "ctrl", type: "control" }],
      };
    case "Retriever":
      return {
        input: [
          { id: "ctrl", type: "control" },
          { id: "tool", type: "tool", label: "As Tool" },
        ],
        output: [{ id: "ctrl", type: "control" }],
      };
    case "WebFetch":
      return {
        input: [{ id: "ctrl", type: "control" }],
        output: [{ id: "ctrl", type: "control" }],
      };
    case "WebSearchTool":
      return { input: [{ id: "tool", type: "tool", label: "As Tool" }], output: [] };
  }
}

/**
 * Get a flat arguments record for any node instance. Used to feed parameter
 * resolution (FromArgs<T> lambdas, activation rules). Output bindings live in
 * the same record under their own (non-colliding) output ids — lambdas address
 * parameters by parameter id and never hit them accidentally.
 */
export function getArguments(node: NodeInstance): Record<string, unknown> {
  return node.arguments as Record<string, unknown>;
}

/**
 * Compute the outputs the node currently can produce (before binding decisions).
 * For FunctionCall: derived from the per-instance functionInfo snapshot (decoupled from live function defs).
 * For all others: derived from the registered NodeDefinition's outputs[] + the node's current arguments.
 *
 * List outputs: only emit-mode entries are surfaced. Assign-mode entries route to
 * existing variables and don't create new output slots in scope — they're validated
 * as bindings, not reported as available outputs.
 */
export function getNodeAvailableOutput(node: NodeInstance): Record<string, NodeOutput> {
  const result: Record<string, NodeOutput> = {};

  if (node.type === "FunctionCall") {
    for (const ret of node.functionInfo.returns) {
      result[ret.uid] = { name: ret.name, dataType: ret.dataType };
    }
    return result;
  }

  const def = NodeRegistry.getByType(node.type);
  if (!def?.outputs) return result;

  const args = node.arguments as Record<string, unknown>;
  for (const out of def.outputs) {
    if (out.type === "static") {
      result[out.id] = {
        name: out.id,
        dataType: resolveStaticOutputDataType(out, node.arguments),
      };
    } else {
      const entries = (args[out.id] as OutputDeclaration[] | undefined) ?? [];
      for (const entry of entries) {
        if (entry.mode === "emit") {
          result[entry.uid] = { name: entry.name, dataType: entry.dataType };
        }
      }
    }
  }
  return result;
}

/**
 * Compute the effective outputs the node emits to variable scope: available outputs
 * filtered to active emit bindings only (inactive bindings and active assign bindings
 * contribute nothing — assign routes to an existing variable, inactive is discarded).
 * Emit bindings carry a user-chosen name that overrides the output's default name (the id).
 *
 * Binding lookup:
 *  - Static outputs (incl. FunctionCall returns): `node.arguments[out.id]`
 *  - List outputs: each entry is already a declaration; emit entries contribute
 *    directly (no separate binding), assign entries contribute nothing
 */
export function getNodeOutput(node: NodeInstance): Record<string, NodeOutput> {
  const result: Record<string, NodeOutput> = {};
  const args = node.arguments as Record<string, unknown>;

  const applyStaticBinding = (key: string, defaultName: string, dataType: NodeOutput["dataType"], binding: OutputBinding | undefined) => {
    // No binding = treat as default emit (the seeded shape). Otherwise honor active+mode.
    if (!binding) {
      result[key] = { name: defaultName, dataType };
      return;
    }
    if (!binding.active) return;
    if (binding.mode !== "emit") return;
    result[key] = { name: binding.name, dataType };
  };

  if (node.type === "FunctionCall") {
    for (const ret of node.functionInfo.returns) {
      applyStaticBinding(ret.uid, ret.name, ret.dataType, getStaticBinding(args, ret.uid));
    }
    return result;
  }

  const def = NodeRegistry.getByType(node.type);
  if (!def?.outputs) return result;

  for (const out of def.outputs) {
    if (out.type === "static") {
      applyStaticBinding(out.id, out.id, resolveStaticOutputDataType(out, node.arguments), getStaticBinding(args, out.id));
    } else {
      const entries = (args[out.id] as OutputDeclaration[] | undefined) ?? [];
      for (const entry of entries) {
        if (entry.mode === "emit") {
          result[entry.uid] = { name: entry.name, dataType: entry.dataType };
        }
      }
    }
  }
  return result;
}

/**
 * Compute external input requirements for a node instance (debug mode).
 * Returns the hardware I/O values the node will read during execution.
 */
export function getInput(node: NodeInstance): ExternalInput[] {
  switch (node.type) {
    case "ReadPin":
      return [
        { kind: "gpio", pinReference: node.arguments.pinReference, dataType: node.arguments.signalType === "digital" ? "bool" : "int" },
      ];
    case "SerialRead":
      return [{ kind: "serial" }];
    case "OnPinEdge":
      return [{ kind: "gpio", pinReference: node.arguments.pinReference, dataType: "bool" }];
    case "OnSerialReceive":
      return [{ kind: "serial" }];
    default:
      return [];
  }
}

/**
 * Determine whether a node is currently used as a tool input
 * (i.e. its tool-input port has an incoming edge).
 *
 * Reads only the connectivity fields off each edge (`target`, `targetHandle`),
 * so it takes the structural {@link GraphEdge} rather than React Flow's `Edge` —
 * keeping this (and its callers in serialization/diagnostics) headless. The
 * editor's React Flow `Edge[]` is structurally assignable without an adapter.
 *
 * Editor-only connection rules (canPortAcceptEdge, getCompatibleNodeDefs,
 * isValidConnection) live in workflow-builder's connectionRules — they operate
 * on React Flow `Node`/`Edge` and have no place in the headless core.
 */
export function isNodeUsedAsTool(nodeId: string, nodeData: NodeInstance, edges: readonly GraphEdge[]): boolean {
  const ports = getPorts(nodeData);
  const toolInputs = ports.input.filter((p) => p.type === "tool");
  if (toolInputs.length === 0) return false;
  return edges.some((e) => e.target === nodeId && toolInputs.some((p) => p.id === e.targetHandle));
}
