import type { Schemas } from "../../api";
import { Expression, NodeInstance, OutputBinding } from ".";
import type { OutputDeclaration } from "../parameter";
import { isParameterActive } from "../parameter";
import { NodeRegistry } from "./NodeRegistry";

/**
 * Serialize a domain NodeInstance to the strict API format (Schemas["Node"]).
 * Strips hidden parameters (those whose activationRules are not met). The
 * `isToolInput` flag is threaded into activation evaluation so rules like
 * `isControlFlow` / `isToolInput` resolve correctly per-instance.
 */
export function serialize(node: NodeInstance, position: { x: number; y: number }, isToolInput = false): Schemas["Node"] {
  const result = serializeNode(node, position, isToolInput);
  if (node.label) {
    (result as Record<string, unknown>).label = node.label;
  }

  // Strip hidden parameters (active=false)
  if ("arguments" in result && result.arguments) {
    const def = node.type !== "FunctionCall" ? NodeRegistry.getByType(node.type) : undefined;
    if (def) {
      const args = result.arguments as Record<string, unknown>;
      for (const param of def.parameters) {
        if (param.activationRules?.length && !isParameterActive(param, node.arguments, isToolInput)) {
          delete args[param.id];
        }
      }
    }
  }

  return result;
}

function serializeNode(node: NodeInstance, position: { x: number; y: number }, isToolInput: boolean): Schemas["Node"] {
  switch (node.type) {
    case "ReadPin":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          pinReference: node.arguments.pinReference!,
          signalType: node.arguments.signalType,
          output: node.arguments.output,
          ...(node.arguments.toolDescription !== undefined ? { toolDescription: node.arguments.toolDescription } : {}),
        },
      };
    case "SerialRead":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          portReference: node.arguments.portReference!,
          prompt: node.arguments.prompt,
          output: node.arguments.output,
        },
      };
    case "WritePin":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          pinReference: node.arguments.pinReference!,
          signalType: node.arguments.signalType,
          value: node.arguments.value,
        },
      };
    case "SerialWrite":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          portReference: node.arguments.portReference!,
          value: node.arguments.value,
        },
      };
    case "Agent": {
      // outputDeclarations is a list both in domain and API. Each entry's `name`
      // is the JSON property the LLM is asked to produce; uniqueness is enforced
      // by diagnostics, not the schema. memoryRefs is also a 1:1 list — domain
      // and API share the same MemoryRef shape.
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          name: node.arguments.name,
          model: node.arguments.model,
          instructions: node.arguments.instructions,
          maxTurns: node.arguments.maxTurns,
          outputDeclarations: node.arguments.outputDeclarations,
          memoryRefs: node.arguments.memoryRefs ?? [],
          answer: node.arguments.answer,
          ...(node.arguments.toolDescription !== undefined ? { toolDescription: node.arguments.toolDescription } : {}),
        },
      };
    }
    case "If":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          condition: node.arguments.condition,
        },
      };
    case "OnFunctionCall":
      return {
        id: node.id,
        type: node.type,
        position: position,
      };
    case "OnStartup":
      return {
        id: node.id,
        type: node.type,
        position: position,
      };
    case "OnPinEdge":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          pinReference: node.arguments.pinReference!,
          edge: node.arguments.edge,
        },
      };
    case "OnSerialReceive":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          portReference: node.arguments.portReference!,
          output: node.arguments.output,
        },
      };
    case "OnThreshold":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          variable: node.arguments.variable!,
          threshold: node.arguments.threshold!,
          direction: node.arguments.direction,
          deadband: node.arguments.deadband,
          output: node.arguments.output,
        },
      };
    case "Delay":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          delayMs: node.arguments.delayMs!,
        },
      };
    case "Ticker":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          intervalValue: node.arguments.intervalValue!,
          intervalUnit: node.arguments.intervalUnit,
        },
      };
    case "Alarm":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          time: node.arguments.time,
          days: node.arguments.days,
        },
      };
    case "WebSearchTool":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          maxResults: node.arguments.maxResults,
        },
      };
    case "Retriever":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          collectionId: node.arguments.collectionId,
          topK: node.arguments.topK!,
          query: node.arguments.query,
          output: node.arguments.output,
          ...(node.arguments.toolDescription !== undefined ? { toolDescription: node.arguments.toolDescription } : {}),
        },
      };
    case "WebFetch":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          url: node.arguments.url,
          maxChars: node.arguments.maxChars,
          output: node.arguments.output,
        },
      };
    case "FunctionCall": {
      // Frontend stores FunctionCall args flat (unified with every other node), but
      // the API schema keeps the nested { inputBindings, outputBindings } shape.
      // Translate here so the wire format stays stable. `toolDescription` sits
      // alongside the bindings at the wire level and is only emitted when the
      // node is currently wired as a tool (exec-mode calls don't need it).
      const inputBindings: Record<string, Expression> = {};
      const outputBindings: Record<string, OutputBinding> = {};
      const args = node.arguments as Record<string, unknown>;
      for (const arg of node.functionInfo.arguments) {
        const key = arg.uid ?? arg.name;
        const v = args[key];
        if (v !== undefined) inputBindings[key] = v as Expression;
      }
      for (const ret of node.functionInfo.returns) {
        const key = ret.uid ?? ret.name;
        const v = args[key];
        if (v !== undefined) outputBindings[key] = v as OutputBinding;
      }
      const toolDescription = args.toolDescription as string | undefined;
      return {
        id: node.id,
        type: node.type,
        functionInfo: node.functionInfo,
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
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          variable: node.arguments.variable!,
          value: node.arguments.value,
        },
      };
    case "MqttPublish":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          channelReference: node.arguments.channelReference ?? "",
          topic: node.arguments.topic,
          dataType: node.arguments.dataType,
          value: node.arguments.value,
          qos: node.arguments.qos,
          retain: node.arguments.retain,
        },
      };
    case "OnMqttMessage":
      return {
        id: node.id,
        type: node.type,
        position: position,
        arguments: {
          channelReference: node.arguments.channelReference ?? "",
          topic: node.arguments.topic,
          dataType: node.arguments.dataType,
          output: node.arguments.output,
        },
      };
  }
}

/**
 * Convert a strict API Node (Schemas["Node"]) to a domain NodeInstance.
 * All required fields are expected to be present — no default injection.
 */
export function deserialize(apiNode: Schemas["Node"]): NodeInstance {
  switch (apiNode.type) {
    case "ReadPin":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          pinReference: apiNode.arguments.pinReference,
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
          portReference: apiNode.arguments.portReference,
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
          collectionId: apiNode.arguments.collectionId,
          topK: apiNode.arguments.topK,
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
          pinReference: apiNode.arguments.pinReference,
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
          portReference: apiNode.arguments.portReference,
          value: apiNode.arguments.value,
        },
      };
    case "Agent":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          name: apiNode.arguments.name,
          model: apiNode.arguments.model,
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
          pinReference: apiNode.arguments.pinReference,
          edge: apiNode.arguments.edge,
        },
      };
    case "OnSerialReceive":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          portReference: apiNode.arguments.portReference,
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
          direction: apiNode.arguments.direction ?? "both",
          deadband: apiNode.arguments.deadband,
          output: (apiNode.arguments.output as OutputBinding | undefined) ?? { active: true, mode: "emit", name: "output" },
        },
      };
    case "Delay":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          delayMs: apiNode.arguments.delayMs,
        },
      };
    case "Ticker":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          intervalValue: apiNode.arguments.intervalValue,
          intervalUnit: apiNode.arguments.intervalUnit,
        },
      };
    case "Alarm":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          time: apiNode.arguments.time,
          days: apiNode.arguments.days ?? [],
        },
      };
    case "WebSearchTool":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          maxResults: apiNode.arguments?.maxResults,
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
      // Lift the wire's nested { inputBindings, outputBindings } into the flat
      // domain arguments record. Uid collisions are impossible within a single
      // function (one namespace across args + returns). `toolDescription`
      // sits at the same level on the wire and is folded into the flat bag
      // under the reserved `toolDescription` key.
      const flat: Record<string, Expression | OutputBinding | string> = {
        ...(apiNode.arguments.inputBindings as Record<string, Expression>),
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
          channelReference: apiNode.arguments.channelReference,
          topic: apiNode.arguments.topic,
          dataType: apiNode.arguments.dataType as "int" | "float" | "bool" | "string",
          value: apiNode.arguments.value,
          qos: apiNode.arguments.qos as 0 | 1 | 2,
          retain: apiNode.arguments.retain,
        },
      };
    case "OnMqttMessage":
      return {
        id: apiNode.id,
        type: apiNode.type,
        label: apiNode.label,
        arguments: {
          channelReference: apiNode.arguments.channelReference,
          topic: apiNode.arguments.topic,
          dataType: apiNode.arguments.dataType as "int" | "float" | "bool" | "string",
          output: apiNode.arguments.output as OutputBinding,
        },
      };
  }
}
