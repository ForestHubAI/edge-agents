import { ModelRegistry, type ModelType, type Model } from "@foresthub/workflow-core/model";
import { useEditorStore } from "../stores/editorStore";
import { generateId } from "@foresthub/workflow-core/id";
import { seedDefaultArguments, uniqueName } from "./resourceHelpers";

/** Default label prefix per model type. */
const LABEL_PREFIX: Record<ModelType, string> = {
  LLMModel: "model",
};

/** Create a new declared (custom) model of the given type. Returns the new instance. */
export function addModel(type: ModelType): Model {
  const id = generateId();
  const existing = Object.values(useEditorStore.getState().models).map((m) => m.label);
  const instance: Model = {
    id,
    label: uniqueName(LABEL_PREFIX[type], existing),
    type,
    arguments: seedDefaultArguments(ModelRegistry.getByType(type)?.parameters ?? []),
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
