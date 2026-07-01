import type { ModelDefinition } from "./ModelDefinition";

/**
 * A declared machine-learning model, served by an inference sidecar, that nodes
 * can reference. The sidecar selects the model by id and derives its behaviour
 * from the mounted model bundle, so nothing needs to be configured here.
 */
export const MLModelDefinition: ModelDefinition = {
  type: "MLModel",
  label: "ML Model",
  description: "A machine-learning model served by an inference sidecar (e.g. object detection)",
  parameters: [],
};
