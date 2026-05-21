import type { Schemas } from "@foresthub/workflow-core";
import { useAvailableProviders } from "@/hooks/useAvailableProviders";

interface DynamicSelectionResult {
  options: Array<{ value: string; label: string }>;
  loading: boolean;
}

// RAG collections are now declared project memory (see `memorySelect` in
// ParameterEditor), so the only remaining externally-sourced selection is the
// LLM model list. Models are still embedder-provided (phase 2).
export type DynamicSelectionType = "llmModels" | null;

export function useDynamicSelectionOptions(
  selectionType: DynamicSelectionType,
  capabilities?: Schemas["ModelCapability"][],
): DynamicSelectionResult {
  const { models, loading: providerLoading } = useAvailableProviders();

  switch (selectionType) {
    case "llmModels": {
      const filtered = capabilities?.length
        ? models.filter((m) => capabilities.every((c) => m.capabilities.includes(c)))
        : models;
      return {
        options: filtered.map((m) => ({ value: m.id, label: m.label })),
        loading: providerLoading,
      };
    }
    default:
      return { options: [], loading: false };
  }
}
