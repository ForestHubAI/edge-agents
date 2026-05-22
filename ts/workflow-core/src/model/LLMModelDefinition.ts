import type { ModelDefinition } from "./ModelDefinition";

/**
 * A declared custom/self-hosted LLM model. The actual provider/endpoint it maps
 * to is a deploy-time binding (see LLMModel.providerBinding in the api,
 * emitted "" by the editor), so it is not an editor parameter. Capabilities
 * default to ["chat"] on serialize; a capability editor can be added later.
 */
export const LLMModelDefinition: ModelDefinition = {
  type: "LLMModel",
  label: "Custom LLM Model",
  description: "A self-hosted or custom LLM the llmproxy doesn't ship by default",
  parameters: [],
};
