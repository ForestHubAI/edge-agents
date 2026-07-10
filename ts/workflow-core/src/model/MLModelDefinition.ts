// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { ModelDefinition } from "./ModelDefinition";

/**
 * A declared machine-learning model, served by an inference component, that nodes
 * can reference. The component selects the model by id and derives its behaviour
 * from the mounted model bundle, so nothing needs to be configured here.
 */
export const MLModelDefinition: ModelDefinition = {
  type: "MLModel",
  label: "ML Model",
  description: "A machine-learning model served by an inference component (e.g. object detection)",
  parameters: [],
};
