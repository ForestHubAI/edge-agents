import type { Schemas } from "@foresthub/workflow-core";
import { useRagCollections } from "@/hooks/useRagCollections";
import { useAvailableProviders } from "@/hooks/useAvailableProviders";

interface DynamicSelectionResult {
  options: Array<{ value: string; label: string }>;
  loading: boolean;
}

export type DynamicSelectionType = "ragCollections" | "llmModels" | null;

export function useDynamicSelectionOptions(
  selectionType: DynamicSelectionType,
  capabilities?: Schemas["ModelCapability"][],
): DynamicSelectionResult {
  const { collections, loading: ragLoading } = useRagCollections();
  const { models, loading: providerLoading } = useAvailableProviders();

  switch (selectionType) {
    case "ragCollections":
      return {
        options: collections.map((c) => ({ value: c.id, label: c.name })),
        loading: ragLoading,
      };
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
