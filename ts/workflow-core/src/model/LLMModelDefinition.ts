// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { ModelDefinition } from "./ModelDefinition";

/**
 * A declared custom/self-hosted LLM model.
 * Capabilities default to ["chat"] on serialize; a capability editor can be added later.
 */
export const LLMModelDefinition: ModelDefinition = {
  type: "LLMModel",
  label: "Custom LLM Model",
  description: "A self-hosted or custom LLM the llmproxy doesn't ship by default",
  parameters: [],
};
