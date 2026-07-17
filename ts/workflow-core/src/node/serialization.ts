// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { Schemas } from "../api";
import type { NodeData, Node } from "./Node";
import type { Expression } from "../api";
import type { FunctionInfo } from "../function";
import type { OutputBinding, OutputDeclaration } from "../parameter";
import { pruneArguments } from "../parameter";
import { NodeRegistry } from "./NodeRegistry";

export type ApiNode = Schemas["Node"];

/**
 * Resolve a function's signature snapshot by id. A `FunctionCall` on the wire stores
 * only `functionId`; deserialize rebuilds the in-memory `functionInfo` snapshot
 * (which core's variable helpers + staleness read) from the workflow's function
 * table via this. Unknown id (e.g. a call to a since-deleted function) → a minimal
 * stub so the node still round-trips and surfaces as deleted.
 */
export type ResolveFunctionInfo = (functionId: string) => FunctionInfo | undefined;

/**
 * A required wire field the workflow may not have yet: drafts save on purpose,
 * and deserialize mirrors this with `??` fallbacks. serialize() emits such a
 * field as absent (see the undefined-prune there); validate / check-schema /
 * deploy are the strictness gates. This is the one deliberate spot where the
 * api's "required" is relaxed — use it instead of `!` assertions.
 */
function draft<T>(value: T | undefined): T {
  return value as T;
}

/**
 * Serialize a domain Node to the strict API format (Schemas["Node"]).
 * Strips hidden parameters (those whose activationRules are not met). The
 * `isToolInput` flag is threaded into activation evaluation so rules like
 * `isControlFlow` / `isToolInput` resolve correctly per-instance.
 */
export function serialize(node: Node, isToolInput: boolean): ApiNode {
  const result = serializeNodeData(node, node.position, isToolInput);
  if (node.label) {
    result.label = node.label;
  }

  // serializeNode emits gated/optional params uniformly; this pass prunes the
  // ones that must not reach the api — inactive for this instance, or empty
  // optionals (so the consumer's presence check sees absent, not `""`/`null`).
  // FunctionCall gates its own params inline (its bindings have a different api
  // shape), so it's excluded here.
  if ("arguments" in result && result.arguments) {
    const def = node.type !== "FunctionCall" ? NodeRegistry.getByType(node.type) : undefined;
    if (def) {
      pruneArguments(result.arguments, def.parameters, isToolInput);
    }
    // Required-but-unset draft arguments (see draft()) are emitted as absent,
    // so the in-memory node matches its JSON form.
    const args = result.arguments as Record<string, unknown>;
    for (const key of Object.keys(args)) {
      if (args[key] === undefined) delete args[key];
    }
  }

  return result;
}

function serializeNodeData(data: NodeData, position: { x: number; y: number }, isToolInput: boolean): Schemas["Node"] {
  switch (data.type) {
    case "ReadPin":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          pinReference: draft(data.arguments.pinReference),
          signalType: data.arguments.signalType,
          output: data.arguments.output,
          toolDescription: data.arguments.toolDescription,
        },
      };
    case "SerialRead":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          portReference: draft(data.arguments.portReference),
          ...(data.arguments.prompt !== undefined ? { prompt: data.arguments.prompt } : {}),
          output: data.arguments.output,
        },
      };
    case "WritePin":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          pinReference: draft(data.arguments.pinReference),
          signalType: data.arguments.signalType,
          value: data.arguments.value,
        },
      };
    case "SerialWrite":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          portReference: draft(data.arguments.portReference),
          value: data.arguments.value,
        },
      };
    case "Agent": {
      // outputDeclarations is a list both in domain and API. Each entry's `name`
      // is the JSON property the LLM is asked to produce; uniqueness is enforced
      // by diagnostics, not the schema. memoryRefs is also a 1:1 list — domain
      // and API share the same MemoryRef shape.
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          name: data.arguments.name,
          model: data.arguments.model,
          instructions: data.arguments.instructions,
          maxTurns: data.arguments.maxTurns,
          outputDeclarations: data.arguments.outputDeclarations,
          memoryRefs: data.arguments.memoryRefs ?? [],
          answer: data.arguments.answer,
          toolDescription: data.arguments.toolDescription,
        },
      };
    }
    case "If":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          condition: data.arguments.condition,
        },
      };
    case "OnFunctionCall":
      return {
        id: data.id,
        type: data.type,
        position: position,
      };
    case "OnStartup":
      return {
        id: data.id,
        type: data.type,
        position: position,
      };
    case "OnPinEdge":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          pinReference: draft(data.arguments.pinReference),
          edge: data.arguments.edge,
        },
      };
    case "OnSerialReceive":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          portReference: draft(data.arguments.portReference),
          output: data.arguments.output,
        },
      };
    case "OnThreshold":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          variable: draft(data.arguments.variable),
          threshold: draft(data.arguments.threshold),
          direction: data.arguments.direction,
          deadband: data.arguments.deadband,
          output: data.arguments.output,
        },
      };
    case "Delay":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          delayMs: draft(data.arguments.delayMs),
        },
      };
    case "Ticker":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          intervalValue: draft(data.arguments.intervalValue),
          intervalUnit: data.arguments.intervalUnit,
        },
      };
    case "Alarm":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          time: data.arguments.time,
          days: data.arguments.days,
        },
      };
    case "WebSearchTool":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          maxResults: data.arguments.maxResults,
        },
      };
    case "Retriever":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          memoryReference: data.arguments.memoryReference,
          topK: draft(data.arguments.topK),
          query: data.arguments.query,
          output: data.arguments.output,
          toolDescription: data.arguments.toolDescription,
        },
      };
    case "WebFetch":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          url: data.arguments.url,
          maxChars: data.arguments.maxChars,
          output: data.arguments.output,
        },
      };
    case "MLInference":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          model: data.arguments.model,
          input: data.arguments.input!,
          output: data.arguments.output,
        },
      };
    case "CameraCapture":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          cameraReference: data.arguments.cameraReference!,
          width: data.arguments.width,
          height: data.arguments.height,
          output: data.arguments.output,
        },
      };
    case "FunctionCall": {
      // Frontend stores FunctionCall args flat (unified with every other node), but
      // the API schema keeps the nested { inputBindings, outputBindings } shape.
      // Translate here so the api format stays stable. `toolDescription` sits
      // alongside the bindings at the api level and is only emitted when the
      // node is currently wired as a tool (exec-mode calls don't need it).
      const inputBindings: Record<string, Expression> = {};
      const outputBindings: Record<string, OutputBinding> = {};
      const args = data.arguments as Record<string, unknown>;
      for (const arg of data.functionInfo.arguments) {
        const key = arg.uid ?? arg.name;
        const v = args[key];
        if (v !== undefined) inputBindings[key] = v as Expression;
      }
      for (const ret of data.functionInfo.returns) {
        const key = ret.uid ?? ret.name;
        const v = args[key];
        if (v !== undefined) outputBindings[key] = v as OutputBinding;
      }
      const toolDescription = args.toolDescription as string | undefined;
      return {
        id: data.id,
        type: data.type,
        functionId: data.functionInfo.id,
        position: position,
        arguments: {
          inputBindings,
          outputBindings,
          ...(isToolInput && toolDescription !== undefined ? { toolDescription } : {}),
        },
      };
    }
    case "SetVariable":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          variable: draft(data.arguments.variable),
          value: data.arguments.value,
        },
      };
    case "MqttPublish":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          channelReference: data.arguments.channelReference ?? "",
          dataType: data.arguments.dataType,
          value: data.arguments.value,
          // Unset stays unset — Number(undefined) is NaN, which stringifies to null.
          qos: draft(data.arguments.qos === undefined ? undefined : (Number(data.arguments.qos) as 0 | 1 | 2)),
          retain: data.arguments.retain,
        },
      };
    case "OnMqttMessage":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          channelReference: data.arguments.channelReference ?? "",
          dataType: data.arguments.dataType,
          output: data.arguments.output,
        },
      };
  }
}

/**
 * Convert a strict API Node to a domain Node (NodeData + position). `resolveFunctionInfo`
 * is required only for `FunctionCall` nodes — see {@link ResolveFunctionInfo}.
 */
export function deserialize(apiNode: ApiNode, resolveFunctionInfo?: ResolveFunctionInfo): Node {
  return { ...deserializeNodeData(apiNode, resolveFunctionInfo), position: apiNode.position };
}

/** Build the NodeData payload from an API Node (no position). */
function deserializeNodeData(apiNode: Schemas["Node"], resolveFunctionInfo?: ResolveFunctionInfo): NodeData {
  switch (apiNode.type) {
    case "ReadPin":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          pinReference: apiNode.arguments.pinReference ?? "",
          signalType: apiNode.arguments.signalType,
          output: apiNode.arguments.output as OutputBinding,
          toolDescription: apiNode.arguments.toolDescription,
        },
      };
    case "SerialRead":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          portReference: apiNode.arguments.portReference ?? "",
          prompt: apiNode.arguments.prompt ?? "",
          output: apiNode.arguments.output as OutputBinding,
        },
      };
    case "Retriever":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          memoryReference: apiNode.arguments.memoryReference ?? "",
          topK: apiNode.arguments.topK ?? 0,
          query: apiNode.arguments.query,
          output: apiNode.arguments.output as OutputBinding,
          toolDescription: apiNode.arguments.toolDescription,
        },
      };
    case "WritePin":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          pinReference: apiNode.arguments.pinReference ?? "",
          signalType: apiNode.arguments.signalType,
          value: apiNode.arguments.value,
        },
      };
    case "SerialWrite":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          portReference: apiNode.arguments.portReference ?? "",
          value: apiNode.arguments.value,
        },
      };
    case "Agent":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          name: apiNode.arguments.name ?? "",
          model: apiNode.arguments.model ?? "",
          instructions: apiNode.arguments.instructions ?? "",
          maxTurns: apiNode.arguments.maxTurns,
          outputDeclarations: apiNode.arguments.outputDeclarations as OutputDeclaration[],
          memoryRefs: apiNode.arguments.memoryRefs ?? [],
          answer: apiNode.arguments.answer as OutputBinding,
          toolDescription: apiNode.arguments.toolDescription,
        },
      };
    case "If":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          condition: apiNode.arguments.condition,
        },
      };
    case "OnFunctionCall":
      return { id: apiNode.id, type: apiNode.type, label: apiNode.label, arguments: {} };
    case "OnStartup":
      return { id: apiNode.id, type: apiNode.type, label: apiNode.label, arguments: {} };
    case "OnPinEdge":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          pinReference: apiNode.arguments.pinReference ?? "",
          edge: apiNode.arguments.edge,
        },
      };
    case "OnSerialReceive":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          portReference: apiNode.arguments.portReference ?? "",
          output: apiNode.arguments.output as OutputBinding,
        },
      };
    case "OnThreshold":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          variable: apiNode.arguments.variable,
          threshold: apiNode.arguments.threshold,
          direction: apiNode.arguments.direction,
          deadband: apiNode.arguments.deadband,
          output: apiNode.arguments.output as OutputBinding,
        },
      };
    case "Delay":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          delayMs: apiNode.arguments.delayMs ?? 0,
        },
      };
    case "Ticker":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          intervalValue: apiNode.arguments.intervalValue ?? 0,
          intervalUnit: apiNode.arguments.intervalUnit,
        },
      };
    case "Alarm":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          time: apiNode.arguments.time ?? "",
          days: apiNode.arguments.days,
        },
      };
    case "WebSearchTool":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          maxResults: apiNode.arguments.maxResults,
        },
      };
    case "WebFetch":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          url: apiNode.arguments.url,
          maxChars: apiNode.arguments.maxChars,
          output: apiNode.arguments.output as OutputBinding,
        },
      };
    case "MLInference":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          model: apiNode.arguments.model ?? "",
          input: apiNode.arguments.input,
          output: apiNode.arguments.output as OutputBinding,
        },
      };
    case "CameraCapture":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          cameraReference: apiNode.arguments.cameraReference ?? "",
          width: apiNode.arguments.width,
          height: apiNode.arguments.height,
          output: apiNode.arguments.output as OutputBinding,
        },
      };
    case "SetVariable":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          variable: apiNode.arguments.variable,
          value: apiNode.arguments.value,
        },
      };
    case "FunctionCall": {
      // Lift the api's nested { inputBindings, outputBindings } into the flat
      // domain arguments record. Uid collisions are impossible within a single
      // function (one namespace across args + returns). `toolDescription`
      // sits at the same level in the api and is folded into the flat bag
      // under the reserved `toolDescription` key.
      const flat: Record<string, Expression | OutputBinding | string> = {
        ...((apiNode.arguments.inputBindings ?? {}) as Record<string, Expression>),
        ...((apiNode.arguments.outputBindings ?? {}) as Record<string, OutputBinding>),
      };
      if (apiNode.arguments.toolDescription !== undefined) {
        flat.toolDescription = apiNode.arguments.toolDescription;
      }
      // The wire carries only `functionId`; rebuild the in-memory signature snapshot
      // from the workflow's function table. A missing function (deleted/hand-edited)
      // gets a minimal stub so the node still loads and surfaces as deleted.
      const functionInfo: FunctionInfo = resolveFunctionInfo?.(apiNode.functionId) ?? {
        id: apiNode.functionId,
        version: 0,
        name: "",
        arguments: [],
        returns: [],
      };
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        functionInfo,
        arguments: flat,
      };
    }
    case "MqttPublish":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          channelReference: apiNode.arguments.channelReference ?? "",
          dataType: apiNode.arguments.dataType as "int" | "float" | "bool" | "string",
          value: apiNode.arguments.value,
          qos: String(apiNode.arguments.qos) as "0" | "1" | "2",
          retain: apiNode.arguments.retain,
        },
      };
    case "OnMqttMessage":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          channelReference: apiNode.arguments.channelReference ?? "",
          dataType: apiNode.arguments.dataType as "int" | "float" | "bool" | "string",
          output: apiNode.arguments.output as OutputBinding,
        },
      };
  }
}
