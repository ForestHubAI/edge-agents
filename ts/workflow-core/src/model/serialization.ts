import type { Schemas } from "../api";
import type { Model, ModelCapability } from "./Model";

export type ApiModel = Schemas["Model"];

/**
 * Serialize a domain Model to the API discriminated-union shape.
 * `providerBinding` is a deploy-time binding emitted as "" — the deploy step
 * maps it to a concrete llmproxy provider (mirrors Channel.driverId).
 */
export function serialize(model: Model): ApiModel {
  const { id, label, type, arguments: args } = model;
  switch (type) {
    case "LLMModel":
      return {
        type,
        id,
        label,
        capabilities: (args.capabilities as ModelCapability[]) ?? ["chat"],
        providerBinding: "",
      };
  }
}

/**
 * Convert an API Model into a domain Model. Deploy-time bindings
 * (providerBinding) are dropped — they aren't part of editor state.
 */
export function deserialize(api: ApiModel): Model {
  const { id, label, type } = api;
  const args: Record<string, unknown> = {};
  switch (type) {
    case "LLMModel":
      args.capabilities = api.capabilities;
      break;
  }
  return { id, label, type, arguments: args };
}
