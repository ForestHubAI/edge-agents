import type { Schemas } from "../api";
import type { Model, ModelCapability } from "./Model";

export type ApiModel = Schemas["Model"];

/** Serialize a domain Model to the API discriminated-union shape. */
export function serialize(model: Model): ApiModel {
  const { id, label, type, arguments: args } = model;
  switch (type) {
    case "LLMModel":
      return {
        type,
        id,
        label,
        capabilities: (args.capabilities as ModelCapability[]) ?? ["chat"],
      };
  }
}

/** Convert an API Model into a domain Model. */
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
