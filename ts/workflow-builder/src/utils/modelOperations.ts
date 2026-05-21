import { ModelRegistry, type ModelType, type ModelInstance } from "@foresthub/workflow-core/model";
import { useEditorStore } from "../stores/editorStore";
import { generateId } from "@foresthub/workflow-core/id";

/**
 * Build the initial `arguments` record for a new declared model: each parameter
 * of the chosen type that declares a `default` gets seeded.
 */
function defaultArguments(type: ModelType): Record<string, unknown> {
  const def = ModelRegistry.getByType(type);
  const args: Record<string, unknown> = {};
  for (const param of def?.parameters ?? []) {
    if ("default" in param && param.default !== undefined) {
      args[param.id] = param.default;
    }
  }
  return args;
}

/** Default label prefix per model type. */
const LABEL_PREFIX: Record<ModelType, string> = {
  LLMModel: "model",
};

/** Pick a fresh `<prefix>N` label that doesn't collide with existing models. */
function nextDefaultLabel(prefix: string, existingLabels: string[]): string {
  let counter = 1;
  while (existingLabels.includes(`${prefix}${counter}`)) counter++;
  return `${prefix}${counter}`;
}

/** Create a new declared (custom) model of the given type. Returns the new instance. */
export function addModel(type: ModelType): ModelInstance {
  const id = generateId();
  const existing = Object.values(useEditorStore.getState().models).map((m) => m.label);
  const instance: ModelInstance = {
    id,
    label: nextDefaultLabel(LABEL_PREFIX[type], existing),
    type,
    arguments: defaultArguments(type),
  };
  useEditorStore.getState().setModels((models) => ({ ...models, [id]: instance }));
  return instance;
}

/**
 * Apply a partial patch to a declared model. Top-level `label` and the
 * `arguments` record merge separately. `type` is fixed at creation.
 */
export function updateModel(id: string, patch: { label?: string; arguments?: Record<string, unknown> }): void {
  const key = id;
  useEditorStore.getState().setModels((models) => {
    const existing = models[key];
    if (!existing) return models;
    return {
      ...models,
      [key]: {
        ...existing,
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.arguments ? { arguments: { ...existing.arguments, ...patch.arguments } } : {}),
      },
    };
  });
}

export function deleteModel(id: string): void {
  const key = id;
  useEditorStore.getState().setModels((models) => {
    const { [key]: _drop, ...rest } = models;
    return rest;
  });
  if (useEditorStore.getState().selectedModelId === id) {
    useEditorStore.getState().setSelectedModelId(null);
  }
}
