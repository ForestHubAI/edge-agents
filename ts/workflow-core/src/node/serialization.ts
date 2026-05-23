import type { Schemas } from "../api";
import type { NodeData, Node } from "./Node";
import type { Expression } from "../api";
import type { OutputBinding, OutputDeclaration } from "../parameter";
import { stripInactiveParameters } from "../parameter";
import { NodeRegistry } from "./NodeRegistry";

export type ApiNode = Schemas["Node"];

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

  // Activation-gated params (e.g. toolDescription): serializeNode emits them
  // uniformly, then this pass drops any that are inactive for this instance, or
  // active but unset — keeping the api free of e.g. `toolDescription: undefined`.
  // FunctionCall gates its own params inline (its bindings have a different api
  // shape), so it's excluded here.
  if ("arguments" in result && result.arguments) {
    const def = node.type !== "FunctionCall" ? NodeRegistry.getByType(node.type) : undefined;
    if (def) {
      stripInactiveParameters(result.arguments as Record<string, unknown>, def.parameters, isToolInput);
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
          pinReference: data.arguments.pinReference!,
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
          portReference: data.arguments.portReference!,
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
          pinReference: data.arguments.pinReference!,
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
          portReference: data.arguments.portReference!,
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
          pinReference: data.arguments.pinReference!,
          edge: data.arguments.edge,
        },
      };
    case "OnSerialReceive":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          portReference: data.arguments.portReference!,
          output: data.arguments.output,
        },
      };
    case "OnThreshold":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          variable: data.arguments.variable!,
          threshold: data.arguments.threshold!,
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
          delayMs: data.arguments.delayMs!,
        },
      };
    case "Ticker":
      return {
        id: data.id,
        type: data.type,
        position: position,
        arguments: {
          intervalValue: data.arguments.intervalValue!,
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
          topK: data.arguments.topK!,
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
        functionInfo: data.functionInfo,
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
          variable: data.arguments.variable!,
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
          topic: data.arguments.topic,
          dataType: data.arguments.dataType,
          value: data.arguments.value,
          qos: data.arguments.qos,
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
          topic: data.arguments.topic,
          dataType: data.arguments.dataType,
          output: data.arguments.output,
        },
      };
  }
}

/**
 * Convert a strict API Node to a domain Node (NodeData + position).
 */
export function deserialize(apiNode: ApiNode): Node {
  return { ...deserializeNodeData(apiNode), position: apiNode.position };
}

/** Build the NodeData payload from an API Node (no position). */
function deserializeNodeData(apiNode: Schemas["Node"]): NodeData {
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
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        functionInfo: apiNode.functionInfo,
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
          topic: apiNode.arguments.topic ?? "",
          dataType: apiNode.arguments.dataType,
          value: apiNode.arguments.value,
          qos: apiNode.arguments.qos,
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
          topic: apiNode.arguments.topic ?? "",
          dataType: apiNode.arguments.dataType,
          output: apiNode.arguments.output as OutputBinding,
        },
      };
  }
}
